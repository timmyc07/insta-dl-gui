use std::time::Duration;

use dom_query::Document;
use futures_util::{stream, StreamExt};
use serde_json::Value;

use crate::cdn::validate_remote_url;
use crate::models::{MediaKind, MediaResource, Post, Profile};
use crate::targets::is_username;

const INSTAGRAM: &str = "https://www.instagram.com";
const MAX_EMBED_BYTES: usize = 4 * 1024 * 1024;
const UNAVAILABLE: &str = "Instagram does not provide this content as a public embed.";

pub struct InstagramClient {
    http: reqwest::Client,
    origin: String,
}

impl InstagramClient {
    pub fn new(proxy: Option<&str>) -> Result<Self, String> {
        Self::with_origin(INSTAGRAM, proxy)
    }

    fn with_origin(origin: &str, proxy: Option<&str>) -> Result<Self, String> {
        let builder = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(20));
        let http = crate::proxy::apply_proxy(builder, proxy)?
            .build()
            .map_err(|_| "Could not configure the Instagram client".to_owned())?;
        Ok(Self {
            http,
            origin: origin.to_owned(),
        })
    }

    async fn embed(&self, path: &str) -> Result<Vec<u8>, String> {
        let response = self
            .http
            .get(format!("{}{path}", self.origin))
            .send()
            .await
            .map_err(|_| "Could not connect to Instagram".to_owned())?;
        let status = response.status();
        match status.as_u16() {
            200 => {}
            429 => return Err("Instagram is rate limiting requests. Try again later.".to_owned()),
            300..=399 | 401 | 403 | 404 => return Err(UNAVAILABLE.to_owned()),
            _ => return Err(format!("Instagram returned HTTP {status}.")),
        }
        let mut chunks = response.bytes_stream();
        let mut body = Vec::new();
        while let Some(chunk) = chunks.next().await {
            let chunk = chunk.map_err(|_| "Instagram closed the page connection".to_owned())?;
            if body.len() + chunk.len() > MAX_EMBED_BYTES {
                return Err("Instagram returned an oversized embed page".to_owned());
            }
            body.extend_from_slice(&chunk);
        }
        Ok(body)
    }

    pub async fn post(&self, code: &str) -> Result<Post, String> {
        if !crate::targets::is_shortcode(code) {
            return Err("Invalid Instagram post code".to_owned());
        }
        let body = self.embed(&format!("/p/{code}/embed/")).await?;
        let post = parse_context(&body)
            .and_then(|embed| map_post(&embed["gql_data"]["shortcode_media"]))
            .or_else(|| map_photo_embed(&body, code))
            .filter(|post| post.code == code && !post.resources.is_empty())
            .ok_or_else(|| UNAVAILABLE.to_owned())?;
        Ok(post)
    }

    pub async fn profile(&self, username: &str) -> Result<(Profile, Vec<Post>), String> {
        if !is_username(username) {
            return Err("Enter a valid Instagram username".to_owned());
        }
        let body = self.embed(&format!("/{username}/embed/")).await?;
        let embed = parse_context(&body).ok_or_else(|| UNAVAILABLE.to_owned())?;
        let context = &embed["context"];
        let profile = map_profile(context)
            .filter(|profile| profile.username.eq_ignore_ascii_case(username))
            .ok_or_else(|| UNAVAILABLE.to_owned())?;
        let posts = context["graphql_media"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|value| map_post(&value["shortcode_media"]))
            .take(6)
            .collect::<Vec<_>>();
        // Profile embeds omit the downloadable video URLs. Resolve these from the public post embeds.
        let posts = stream::iter(posts.into_iter().map(|mut preview| async move {
            if preview.resources.is_empty() {
                if let Ok(post) = self.post(&preview.code).await {
                    preview.resources = post.resources;
                }
            }
            preview
        }))
        .buffered(2)
        .collect()
        .await;
        Ok((profile, posts))
    }
}

fn parse_context(body: &[u8]) -> Option<Value> {
    let html = std::str::from_utf8(body).ok()?;
    let (_, json) = html.split_once("\"contextJSON\":")?;
    let escaped = serde_json::Deserializer::from_str(json)
        .into_iter::<String>()
        .next()?
        .ok()?;
    serde_json::from_str(&escaped).ok()
}

fn embedded_url(value: &Value) -> Option<String> {
    media_url(value.as_str()?)
}

fn media_url(url: &str) -> Option<String> {
    validate_remote_url(url, false).ok()?;
    Some(url.to_owned())
}

fn map_photo_embed(body: &[u8], code: &str) -> Option<Post> {
    let document = Document::from(std::str::from_utf8(body).ok()?);
    let card = document.select_single("[data-media-type='GraphImage'][data-media-id]");
    let permalink = card.attr("data-permalink")?;
    if crate::targets::Target::parse(&permalink)?
        != (crate::targets::Target::Post {
            code: code.to_owned(),
        })
    {
        return None;
    }
    let image = card.select("img.EmbeddedMediaImage");
    let url = media_url(&image.attr("src")?)?;
    let owner_username = card
        .select("a.Username")
        .attr("href")
        .and_then(|href| crate::targets::Target::parse(&href))
        .and_then(|target| match target {
            crate::targets::Target::Profile { username } => Some(username),
            _ => None,
        });
    Some(Post {
        pk: card.attr("data-media-id")?.to_string(),
        code: code.to_owned(),
        taken_at: None,
        caption: None,
        like_count: None,
        comment_count: None,
        owner_username,
        owner_pk: card.attr("data-owner-id").map(|id| id.to_string()),
        thumbnail_url: Some(url.clone()),
        resources: vec![MediaResource {
            url,
            kind: MediaKind::Photo,
        }],
    })
}

fn map_profile(context: &Value) -> Option<Profile> {
    Some(Profile {
        pk: context["owner_id"].as_u64()?.to_string(),
        username: context["username"].as_str()?.to_owned(),
        full_name: context["full_name"].as_str().map(String::from),
        media_count: context["posts_count"].as_u64().unwrap_or_default(),
        follower_count: context["followers_count"].as_u64(),
        is_verified: context["is_verified"].as_bool().unwrap_or_default(),
        avatar_url: embedded_url(&context["profile_pic_url"]),
    })
}

fn resource(media: &Value) -> Option<MediaResource> {
    let (key, kind) = if media["is_video"].as_bool()? {
        ("video_url", MediaKind::Video)
    } else {
        ("display_url", MediaKind::Photo)
    };
    Some(MediaResource {
        url: embedded_url(&media[key])?,
        kind,
    })
}

fn map_post(media: &Value) -> Option<Post> {
    let code = media["shortcode"].as_str()?;
    if !crate::targets::is_shortcode(code) {
        return None;
    }
    let resources = if media["__typename"] == "GraphSidecar" {
        media["edge_sidecar_to_children"]["edges"]
            .as_array()
            .and_then(|edges| edges.iter().map(|edge| resource(&edge["node"])).collect())
            .unwrap_or_default()
    } else {
        resource(media).into_iter().collect()
    };
    Some(Post {
        pk: media["id"].as_str()?.to_owned(),
        code: code.to_owned(),
        taken_at: media["taken_at_timestamp"].as_i64(),
        caption: media["edge_media_to_caption"]["edges"][0]["node"]["text"]
            .as_str()
            .map(String::from),
        like_count: media["edge_liked_by"]["count"].as_u64(),
        comment_count: media["edge_media_to_comment"]["count"].as_u64(),
        owner_username: media["owner"]["username"].as_str().map(String::from),
        owner_pk: media["owner"]["id"].as_str().map(String::from),
        thumbnail_url: embedded_url(&media["display_url"]),
        resources,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn reads_public_embed_without_a_login_and_preserves_album_order() {
        let server = MockServer::start().await;
        let media = json!({
            "__typename": "GraphSidecar",
            "id": "42", "shortcode": "Xyz1", "owner": {"username": "example"},
            "edge_sidecar_to_children": {"edges": [
                {"node": {"is_video": false, "display_url": "https://scontent.cdninstagram.com/image.jpg"}},
                {"node": {"is_video": true, "video_url": "https://instagram.fbcdn.net/video.mp4"}}
            ]}
        });
        let context = json!({"gql_data":{"shortcode_media": media}});
        let html = format!(
            "<script>{{\"contextJSON\":{}}}</script>",
            json!(context.to_string())
        );
        Mock::given(method("GET"))
            .and(path("/p/Xyz1/embed/"))
            .respond_with(ResponseTemplate::new(200).set_body_string(html))
            .expect(1)
            .mount(&server)
            .await;
        let client = InstagramClient::with_origin(&server.uri(), None).unwrap();
        let post = client.post("Xyz1").await.unwrap();
        assert_eq!(
            post.resources.iter().map(|r| r.kind).collect::<Vec<_>>(),
            vec![MediaKind::Photo, MediaKind::Video]
        );
        let requests = server.received_requests().await.unwrap();
        assert!(!requests[0].headers.contains_key("authorization"));
        assert!(!requests[0].headers.contains_key("cookie"));
    }

    #[tokio::test]
    async fn does_not_follow_a_login_redirect() {
        let server = MockServer::start().await;
        Mock::given(path("/p/Xyz1/embed/"))
            .respond_with(ResponseTemplate::new(302).insert_header("location", "/accounts/login/"))
            .mount(&server)
            .await;
        let client = InstagramClient::with_origin(&server.uri(), None).unwrap();
        assert_eq!(client.post("Xyz1").await.unwrap_err(), UNAVAILABLE);
        assert_eq!(server.received_requests().await.unwrap().len(), 1);
    }

    #[test]
    fn reads_a_single_photo_embed_and_decodes_url_entities() {
        let html = br#"<div data-media-type="GraphImage" data-media-id="42" data-owner-id="17"
            data-permalink="https://www.instagram.com/p/Xyz1/?foo=1&amp;bar=2">
            <a class="Username" href="https://www.instagram.com/example/">example</a>
            <img class="EmbeddedMediaImage" src="https://scontent.cdninstagram.com/photo.jpg?foo=1&amp;bar=2">
            </div>"#;
        let post = map_photo_embed(html, "Xyz1").unwrap();
        assert_eq!(post.pk, "42");
        assert_eq!(post.owner_username.as_deref(), Some("example"));
        assert_eq!(
            post.resources[0].url,
            "https://scontent.cdninstagram.com/photo.jpg?foo=1&bar=2"
        );
        assert!(map_photo_embed(html, "Other").is_none());
    }
}
