fn main() {
    #[cfg(target_os = "macos")]
    compile_macos_chrome();
    tauri_build::build();
}

#[cfg(target_os = "macos")]
fn compile_macos_chrome() {
    use std::env;
    use std::path::PathBuf;
    use std::process::Command;

    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let src = manifest.join("src/macos_chrome.m");
    println!("cargo:rerun-if-changed={}", src.display());

    // Universal builds compile this crate twice (arm64 + x86_64). Host clang
    // defaults to the runner arch, so we must pass -arch for TARGET.
    let clang_arch = match env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("aarch64") => "arm64",
        Ok("x86_64") => "x86_64",
        other => panic!("unsupported macOS target arch: {other:?}"),
    };

    let out = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let obj = out.join("macos_chrome.o");
    let lib = out.join("libpolarr_macos_chrome.a");

    let mut clang = Command::new("clang");
    clang.args(["-c", "-fobjc-arc", "-arch", clang_arch]);
    if let Ok(min) = env::var("MACOSX_DEPLOYMENT_TARGET") {
        clang.arg(format!("-mmacosx-version-min={min}"));
    }
    clang.arg(&src).arg("-o").arg(&obj);

    let status = clang.status().expect("clang (Objective-C)");
    if !status.success() {
        panic!("clang failed to compile src/macos_chrome.m for {clang_arch}");
    }

    let status = Command::new("ar")
        .args(["crus"])
        .arg(&lib)
        .arg(&obj)
        .status()
        .expect("ar");
    if !status.success() {
        panic!("ar failed to archive macos chrome object");
    }

    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=polarr_macos_chrome");
    println!("cargo:rustc-link-lib=framework=AppKit");
    println!("cargo:rustc-link-lib=framework=WebKit");
}
