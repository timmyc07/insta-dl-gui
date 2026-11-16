use std::time::Duration;

use tokio::sync::watch;

use crate::instagram::InstagramClient;

use super::*;

const PAGE_INTERVAL: Duration = Duration::from_secs(1);

#[allow(clippy::too_many_arguments)]
pub(super) async fn run(
    instagram: &InstagramClient,
    username: &str,
    cdn: &reqwest::Client,
    catalog: &Catalog,
    root: &Path,
    cfg: &Config,
    progress: &dyn ProgressSink,
    dir: &Path,
    mut cancel: watch::Receiver<bool>,
    allow_loopback: bool,
) -> Result<CompletedJob, JobFail> {
    let timeline = tokio::select! {
        biased;
        _ = cancel.wait_for(|stop| *stop) => return Err(JobFail::Cancelled),
        timeline = instagram.public_timeline(username) => timeline?,
    };
    std::fs::create_dir_all(dir)?;
    let mut batch = PostBatch::default();
    let mut seen_posts = HashSet::new();
    let mut seen_cursors = HashSet::new();
    let mut cursor = None;
    let mut page_number = 1;

    loop {
        let bytes = *batch.reported_bytes.lock().unwrap();
        progress.progress(
            batch.file_offset,
            0,
            bytes,
            &format!("Fetching public page {page_number}…"),
        );
        let page = tokio::select! {
            biased;
            _ = cancel.wait_for(|stop| *stop) => return Err(JobFail::Cancelled),
            page = timeline.page(cursor.as_deref(), &seen_posts) => page
                .map_err(|error| stopped(batch.outcome.files_written, error))?,
        };
        let mut downloadable = Vec::new();
        for post in page.posts {
            if !seen_posts.insert(post.code.clone()) {
                continue;
            }
            if post.resources.is_empty() {
                batch.record_error(format!(
                    "Post {} has no downloadable public embed",
                    post.code
                ));
            } else {
                downloadable.push(post);
            }
        }
        // Large archives use the Library for file inspection instead of sending every file in a Queue event.
        batch
            .download(
                cdn,
                catalog,
                root,
                cfg,
                progress,
                dir,
                &downloadable,
                Some(cancel.clone()),
                0,
                false,
                allow_loopback,
            )
            .await?;
        if *cancel.borrow() {
            return Err(JobFail::Cancelled);
        }
        let Some(next) = page.next_cursor else {
            break;
        };
        if !seen_cursors.insert(next.clone()) {
            return Err(stopped(
                batch.outcome.files_written,
                "Instagram repeated a pagination cursor.",
            ));
        }
        cursor = Some(next);
        page_number += 1;
        tokio::select! {
            biased;
            _ = cancel.wait_for(|stop| *stop) => return Err(JobFail::Cancelled),
            _ = tokio::time::sleep(PAGE_INTERVAL) => {}
        }
    }
    batch.finish(seen_posts.len())
}

fn stopped(files_written: usize, error: impl std::fmt::Display) -> JobFail {
    JobFail::Fatal(format!(
        "Archive stopped after saving {files_written} files. {error}"
    ))
}
