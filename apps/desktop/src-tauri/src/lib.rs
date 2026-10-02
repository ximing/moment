use tauri::webview::WebviewWindowBuilder;
use tauri_plugin_opener::OpenerExt;

/// 线上 Web。壳只渲染这个源，不打包前端。
const APP_HOST: &str = "moment.aimo.plus";

/// 顶层导航留在壳里的地址。图片和接口是子资源，不经过这里。
fn stay_in_shell(url: &url::Url) -> bool {
    match url.scheme() {
        "about" | "blob" | "data" => true,
        "http" | "https" => url.host_str() == Some(APP_HOST),
        _ => false,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let window = app
                .config()
                .app
                .windows
                .first()
                .expect("缺少主窗口配置");
            let navigate_handle = app.handle().clone();
            let popup_handle = app.handle().clone();
            WebviewWindowBuilder::from_config(app.handle(), window)?
                .on_navigation(move |url| {
                    if stay_in_shell(url) {
                        return true;
                    }
                    let _ = navigate_handle.opener().open_url(url.as_str(), None::<&str>);
                    false
                })
                .on_new_window(move |url, _features| {
                    if stay_in_shell(&url) {
                        return tauri::webview::NewWindowResponse::Allow;
                    }
                    let _ = popup_handle.opener().open_url(url.as_str(), None::<&str>);
                    tauri::webview::NewWindowResponse::Deny
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动时刻桌面壳失败");
}
