use std::path::Path;

pub(crate) const IMAGES: &str = "images";
pub(crate) const VIDEOS: &str = "videos";
pub(crate) const METADATA: &str = "metadata";

pub(crate) fn media_directory(path: &Path) -> &Path {
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    if matches!(
        parent.file_name().and_then(|name| name.to_str()),
        Some(IMAGES | VIDEOS | METADATA)
    ) {
        parent.parent().unwrap_or_else(|| Path::new(""))
    } else {
        parent
    }
}
