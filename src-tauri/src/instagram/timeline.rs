use std::collections::HashSet;

use dom_query::Document;
use futures_util::{stream, StreamExt, TryStreamExt};
use serde::Serialize;
use serde_json::{json, Value};

use super::{embedded_url, read_public_response, InstagramClient, UNAVAILABLE};
use crate::models::Post;
use crate::targets::{is_shortcode, is_username};

// Instagram's logged-out desktop profile posts pagination query, also used by Instaloader 4.16.
const PUBLIC_POSTS_QUERY: &str = "28904005159232689";
const PAGE_SIZE: usize = 12;
const MAX_PAGE_ITEMS: usize = 50;
const MAX_CURSOR_BYTES: usize = 2048;
const TIMELINE_UNAVAILABLE: &str =
    "Instagram did not provide another public page for this profile.";
const TIMELINE_KEY: &str = "polaris_ordered_timeline_connection";

#[derive(Debug, Serialize)]
pub struct TimelinePage {
    pub posts: Vec<Post>,
    pub next_cursor: Option<String>,
}

struct PublicProfilePage {
    id: String,
    first_page: Value,
    lsd: Option<String>,
}

pub(crate) struct PublicTimeline<'a> {
    client: &'a InstagramClient,
    url: String,
    profile: PublicProfilePage,
}

impl InstagramClient {
    pub async fn timeline(
        &self,
        username: &str,
        cursor: Option<&str>,
        shown_codes: &[String],
    ) -> Result<TimelinePage, String> {
        if cursor.is_some_and(|value| !valid_cursor(value))
            || shown_codes.len() > 500
            || shown_codes.iter().any(|code| !is_shortcode(code))
        {
            return Err("Invalid public timeline request".to_owned());
        }

        let timeline = self.public_timeline(username).await?;
        let seen = shown_codes.iter().cloned().collect();
        timeline.page(cursor, &seen).await
    }

    pub(crate) async fn public_timeline(
        &self,
        username: &str,
    ) -> Result<PublicTimeline<'_>, String> {
        if !is_username(username) {
            return Err("Enter a valid Instagram username".to_owned());
        }
        let url = format!("{}/{username}/", self.origin);
        let response = self
            .http
            .get(&url)
            .header("accept", "text/html")
            .header("sec-fetch-dest", "document")
            .header("sec-fetch-mode", "navigate")
            .header("sec-fetch-site", "none")
            .send()
            .await
            .map_err(|_| "Could not connect to Instagram".to_owned())?;
        let body = read_public_response(response, TIMELINE_UNAVAILABLE).await?;
        let profile =
            public_profile_page(&body, username).ok_or_else(|| TIMELINE_UNAVAILABLE.to_owned())?;
        Ok(PublicTimeline {
            client: self,
            url,
            profile,
        })
    }

    async fn timeline_after(
        &self,
        profile_url: &str,
        profile: &PublicProfilePage,
        cursor: &str,
    ) -> Result<Value, String> {
        let lsd = profile
            .lsd
            .as_deref()
            .ok_or_else(|| TIMELINE_UNAVAILABLE.to_owned())?;
        let variables = json!({
            "id": profile.id,
            "first": PAGE_SIZE,
            "after": cursor,
            "__relay_internal__pv__PolarisSEOIsCrawlerrelayprovider": false
        })
        .to_string();
        let response = self
            .http
            .post(format!("{}/api/graphql", self.origin))
            .header("origin", &self.origin)
            .header("referer", profile_url)
            .header("x-fb-lsd", lsd)
            .header("accept", "application/json")
            .header("sec-fetch-dest", "empty")
            .header("sec-fetch-mode", "cors")
            .header("sec-fetch-site", "same-origin")
            .form(&[
                ("doc_id", PUBLIC_POSTS_QUERY),
                ("variables", &variables),
                ("lsd", lsd),
                ("av", "0"),
                ("server_timestamps", "true"),
            ])
            .send()
            .await
            .map_err(|_| "Could not connect to Instagram".to_owned())?;
        let body = read_public_response(response, TIMELINE_UNAVAILABLE).await?;
        let mut data: Value =
            serde_json::from_slice(&body).map_err(|_| TIMELINE_UNAVAILABLE.to_owned())?;
        let connection = data["data"]["node"][TIMELINE_KEY].take();
        if !connection.is_object() {
            return Err(TIMELINE_UNAVAILABLE.to_owned());
        }
        Ok(connection)
    }
}

impl PublicTimeline<'_> {
    pub(crate) async fn page(
        &self,
        cursor: Option<&str>,
        seen: &HashSet<String>,
    ) -> Result<TimelinePage, String> {
        let continuation;
        let connection = if let Some(cursor) = cursor {
            continuation = self
                .client
                .timeline_after(&self.url, &self.profile, cursor)
                .await?;
            &continuation
        } else {
            &self.profile.first_page
        };
        let (mut posts, next_cursor) = timeline_posts(connection)?;
        posts.retain(|post| !seen.contains(&post.code));

        let posts = stream::iter(posts.into_iter().map(|mut preview| async move {
            match self.client.post(&preview.code).await {
                Ok(post) => {
                    preview.resources = post.resources;
                    preview.taken_at = post.taken_at;
                    preview.like_count = post.like_count;
                    preview.comment_count = post.comment_count;
                    preview.thumbnail_url = post.thumbnail_url.or(preview.thumbnail_url);
                }
                Err(error) if error == UNAVAILABLE => {}
                Err(error) => return Err(error),
            }
            Ok(preview)
        }))
        .buffered(2)
        .try_collect()
        .await?;
        Ok(TimelinePage { posts, next_cursor })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn connection(codes: &[&str], next: Option<&str>) -> Value {
        let edges: Vec<_> = codes.iter().enumerate().map(|(i, code)| json!({
            "node": {"pk": (i + 1).to_string(), "code": code, "user": {"username": "example"}}
        })).collect();
        json!({"edges": edges, "page_info": {"has_next_page": next.is_some(), "end_cursor": next}})
    }

    fn html(first: Value, is_private: bool) -> String {
        let payload = json!({"require": [
            {"__bbox": {"result": {"data": {"xig_user_by_username": {
                "username": "example", "pk": "42", "is_private": is_private
            }}}}},
            {"__bbox": {"result": {"data": {"xig_user_by_username": {
                "id": "public-relay-id", "polaris_ordered_timeline_connection": first
            }}}}}
        ]});
        format!(
            r#"<script>["LSD",[],{{"token":"guest-nonce"}}]</script><script type="application/json">{payload}</script>"#
        )
    }

    #[tokio::test]
    async fn follows_the_public_cursor_without_authentication_and_skips_shown_codes() {
        let server = MockServer::start().await;
        let public_html = html(connection(&["Seen", "Older"], Some("next-1")), false);
        Mock::given(method("GET"))
            .and(path("/example/"))
            .respond_with(ResponseTemplate::new(200).set_body_string(public_html))
            .expect(2)
            .mount(&server)
            .await;
        for code in ["Older", "Oldest"] {
            Mock::given(method("GET")).and(path(format!("/p/{code}/embed/")))
                .respond_with(ResponseTemplate::new(200).set_body_string(format!(
                    r#"<div data-media-type="GraphImage" data-media-id="{code}" data-permalink="https://www.instagram.com/p/{code}/"><img class="EmbeddedMediaImage" src="https://scontent.cdninstagram.com/photo.jpg"></div>"#
                )))
                .expect(1).mount(&server).await;
        }
        Mock::given(method("POST")).and(path("/api/graphql"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "data":{"node":{"polaris_ordered_timeline_connection":connection(&["Oldest"], None)}}
            })))
            .expect(1).mount(&server).await;

        let client = InstagramClient::with_origin(&server.uri(), None).unwrap();
        let first = client
            .timeline("example", None, &["Seen".into()])
            .await
            .unwrap();
        assert_eq!(first.posts.len(), 1);
        assert_eq!(first.posts[0].code, "Older");
        assert_eq!(first.posts[0].resources.len(), 1);
        let second = client
            .timeline("example", first.next_cursor.as_deref(), &[])
            .await
            .unwrap();
        assert_eq!(second.posts[0].code, "Oldest");
        assert_eq!(second.next_cursor, None);

        let requests = server.received_requests().await.unwrap();
        assert!(requests
            .iter()
            .all(|req| !req.headers.contains_key("cookie")
                && !req.headers.contains_key("authorization")));
        let request = requests
            .iter()
            .find(|req| req.url.path() == "/api/graphql")
            .unwrap();
        let params: std::collections::HashMap<_, _> =
            url::form_urlencoded::parse(&request.body).collect();
        let variables: Value = serde_json::from_str(&params["variables"]).unwrap();
        assert_eq!(variables["after"], "next-1");
        assert_eq!(variables["id"], "public-relay-id");
    }

    #[test]
    fn accepts_only_the_requested_public_profile() {
        let private = html(connection(&["Hidden"], None), true);
        let public = html(connection(&["Public"], None), false);
        assert!(public_profile_page(private.as_bytes(), "example").is_none());
        assert!(public_profile_page(public.as_bytes(), "someone.else").is_none());
        assert!(public_profile_page(public.as_bytes(), "example").is_some());
    }
}

fn public_profile_page(body: &[u8], username: &str) -> Option<PublicProfilePage> {
    let html = std::str::from_utf8(body).ok()?;
    let document = Document::from(html);
    let mut timeline = None;
    let mut public_profile = false;
    for script in document.select("script[type='application/json']").nodes() {
        let source = script.text();
        if !source.contains("xig_user_by_username") {
            continue;
        }
        let Ok(data) = serde_json::from_str::<Value>(&source) else {
            continue;
        };
        let mut pending = vec![&data];
        while let Some(value) = pending.pop() {
            if let Some(user) = value.pointer("/__bbox/result/data/xig_user_by_username") {
                if user["is_private"] == true {
                    return None;
                }
                if user["is_private"] == false
                    && user["username"]
                        .as_str()
                        .is_some_and(|name| name.eq_ignore_ascii_case(username))
                {
                    public_profile = true;
                }
                if let Some(id) = user["id"].as_str().filter(|id| !id.is_empty()) {
                    if user[TIMELINE_KEY].is_object() {
                        timeline = Some((id.to_owned(), user[TIMELINE_KEY].clone()));
                    }
                }
            }
            match value {
                Value::Object(values) => pending.extend(values.values()),
                Value::Array(values) => pending.extend(values),
                _ => {}
            }
        }
    }
    let (id, first_page) = timeline.filter(|_| public_profile)?;
    let lsd = html.split_once("\"LSD\",[],").and_then(|(_, payload)| {
        let config = serde_json::Deserializer::from_str(payload)
            .into_iter::<Value>()
            .next()?
            .ok()?;
        let token = config["token"].as_str()?;
        (token.len() <= 128 && !token.is_empty()).then(|| token.to_owned())
    });
    Some(PublicProfilePage {
        id,
        first_page,
        lsd,
    })
}

fn valid_cursor(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_CURSOR_BYTES
        && !value.bytes().any(|b| b.is_ascii_control())
}

fn timeline_posts(connection: &Value) -> Result<(Vec<Post>, Option<String>), String> {
    let edges = connection["edges"]
        .as_array()
        .filter(|edges| edges.len() <= MAX_PAGE_ITEMS)
        .ok_or_else(|| TIMELINE_UNAVAILABLE.to_owned())?;
    let mut seen = HashSet::new();
    let posts = edges
        .iter()
        .map(|edge| &edge["node"])
        .filter_map(|node| {
            let code = node["code"].as_str().filter(|code| is_shortcode(code))?;
            let pk = node["pk"].as_str().filter(|pk| !pk.is_empty())?;
            if !seen.insert(code) {
                return None;
            }
            Some(Post {
                pk: pk.to_owned(),
                code: code.to_owned(),
                taken_at: None,
                caption: node["caption"]["text"].as_str().map(String::from),
                like_count: None,
                comment_count: None,
                owner_username: node["user"]["username"].as_str().map(String::from),
                owner_pk: node["user"]["id"].as_str().map(String::from),
                resources: Vec::new(),
                thumbnail_url: embedded_url(&node["display_uri"]),
            })
        })
        .collect();
    let next_cursor = if connection["page_info"]["has_next_page"] == true {
        Some(
            connection["page_info"]["end_cursor"]
                .as_str()
                .filter(|next| valid_cursor(next))
                .ok_or_else(|| TIMELINE_UNAVAILABLE.to_owned())?
                .to_owned(),
        )
    } else {
        None
    };
    Ok((posts, next_cursor))
}
