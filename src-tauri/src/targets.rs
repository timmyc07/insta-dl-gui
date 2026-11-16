use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum Target {
    Profile { username: String },
    Post { code: String },
}

impl Target {
    pub fn parse(input: &str) -> Option<Self> {
        let s = input.trim();
        if s.is_empty() {
            return None;
        }

        // @username
        let bare = s.strip_prefix('@').unwrap_or(s);
        if !s.contains("instagram.com") && !s.contains('/') && is_username(bare) {
            return Some(Self::Profile {
                username: bare.to_lowercase(),
            });
        }
        let url = if s.contains("://") {
            url::Url::parse(s).ok()?
        } else {
            url::Url::parse(&format!("https://{s}")).ok()?
        };
        if !matches!(url.scheme(), "http" | "https")
            || !matches!(url.host_str(), Some("instagram.com" | "www.instagram.com"))
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return None;
        }
        let segments: Vec<_> = url.path().trim_matches('/').split('/').collect();
        match segments.as_slice() {
            [kind, code] | [_, kind, code]
                if matches!(*kind, "p" | "reel" | "reels" | "tv") && is_shortcode(code) =>
            {
                Some(Self::Post {
                    code: (*code).to_owned(),
                })
            }
            [username] if is_username(username) => Some(Self::Profile {
                username: username.to_lowercase(),
            }),
            _ => None,
        }
    }
}

pub(crate) fn is_username(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 30
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_')
        && !s.starts_with('.')
        && !s.ends_with('.')
}

pub(crate) fn is_shortcode(code: &str) -> bool {
    !code.is_empty()
        && code.len() <= 64
        && code
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_bare_username() {
        assert_eq!(
            Target::parse("instagram"),
            Some(Target::Profile {
                username: "instagram".into()
            })
        );
        assert_eq!(
            Target::parse("@NatGeo"),
            Some(Target::Profile {
                username: "natgeo".into()
            })
        );
    }

    #[test]
    fn parses_post_urls() {
        for form in [
            "https://www.instagram.com/p/DXZlTiKEpxw/",
            "https://instagram.com/p/DXZlTiKEpxw",
            "https://www.instagram.com/reel/DXZlTiKEpxw/?igsh=xyz",
            "https://www.instagram.com/reels/DXZlTiKEpxw/",
        ] {
            assert_eq!(
                Target::parse(form),
                Some(Target::Post {
                    code: "DXZlTiKEpxw".into()
                }),
                "{form}"
            );
        }
    }

    #[test]
    fn parses_profile_urls() {
        assert_eq!(
            Target::parse("https://www.instagram.com/natgeo/"),
            Some(Target::Profile {
                username: "natgeo".into()
            })
        );
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(Target::parse(""), None);
        assert_eq!(Target::parse("hello world"), None);
        assert_eq!(Target::parse("https://example.com/p/abc"), None);
        assert_eq!(Target::parse("-leading-dash"), None);
    }
}
