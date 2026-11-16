use std::sync::Arc;

use crate::config::Config;
use crate::instagram::InstagramClient;

pub struct NetworkClients {
    pub instagram: Arc<InstagramClient>,
    pub cdn: reqwest::Client,
}

impl NetworkClients {
    pub fn from_config(config: &Config) -> Result<Self, String> {
        let proxy = config.proxy_url.as_deref();
        Ok(Self {
            instagram: Arc::new(InstagramClient::new(proxy)?),
            cdn: build_cdn_client(proxy)?,
        })
    }
}

pub fn build_cdn_client(proxy_url: Option<&str>) -> Result<reqwest::Client, String> {
    crate::proxy::apply_proxy(
        reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()),
        proxy_url,
    )?
    .build()
    .map_err(|_| "Could not configure the CDN client".to_owned())
}
