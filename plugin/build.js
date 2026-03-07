// build.js — ESBuild + archiver 打包脚本
// 输出：build/dist/ai-sch-generator-{version}.eext（ZIP 格式）
// .eext 内部结构：extension.json + dist/index.js + iframe/

'use strict';

const esbuild = require('esbuild');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const BUILD_DIR = path.join(ROOT, 'build');
const DIST_DIR = path.join(BUILD_DIR, 'dist');

async function main() {
  // 1. 清理并重建 build 目录
  if (fs.existsSync(BUILD_DIR)) {
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });

  // 2. 用 ESBuild 编译 TypeScript → JS（IIFE 格式，浏览器兼容）
  const compiledJs = path.join(DIST_DIR, 'index.js');
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'index.ts')],
    bundle: true,
    outfile: compiledJs,
    platform: 'browser',
    target: 'es2020',
    format: 'iife',
    globalName: 'edaEsbuildExportName', // EDA 运行时固定查找此全局变量名
    logLevel: 'info',
  });
  console.log('✅ TypeScript → JavaScript 编译完成');

  // 3. 读取扩展配置
  const extConfig = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'extension.json'), 'utf-8')
  );
  const eextName = `${extConfig.name}-${extConfig.version}.eext`;
  const eextPath = path.join(DIST_DIR, eextName);

  // 4. 用 esbuild 打包 app.js（含 npm 依赖，如 qrcode），然后内联到 index.html
  const iframeDir = path.join(ROOT, 'iframe');
  const htmlSrc = path.join(iframeDir, 'index.html');
  const jsSrc   = path.join(iframeDir, 'app.js');

  let htmlContent = fs.readFileSync(htmlSrc, 'utf-8');

  // 使用 esbuild 打包（write:false，不写文件，直接拿 outputFiles[0].text）
  const appBundleResult = await esbuild.build({
    entryPoints: [jsSrc],
    bundle:      true,
    write:       false,
    platform:    'browser',
    target:      'es2020',
    format:      'iife',
    logLevel:    'warning',
  });
  const jsContent = appBundleResult.outputFiles[0].text;

  // 将 <script src="app.js"></script> 替换为内联 <script>...内容...</script>
  htmlContent = htmlContent.replace(
    /<script\s+src=["']app\.js["']\s*><\/script>/,
    `<script>\n${jsContent}\n</script>`
  );

  // 去除调试面板和内联诊断脚本（生产包不需要）
  // 如需保留调试，将下面两行注释掉
  htmlContent = htmlContent.replace(
    /\s*<!-- 调试日志面板[\s\S]*?<\/script>/,
    ''
  );

  const inlinedHtml = path.join(BUILD_DIR, '_index_inlined.html');
  fs.writeFileSync(inlinedHtml, htmlContent, 'utf-8');

  // 5. 打包为 .eext（ZIP 文件）
  // ZIP 内部结构：
  //   extension.json        ← 插件配置
  //   dist/index.js         ← 编译后的 JS（entry: "./dist/index"）
  //   iframe/index.html     ← IFrame UI
  //   iframe/app.js         ← IFrame JS
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(eextPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);

    // 添加 extension.json（ZIP 根目录）
    archive.file(path.join(ROOT, 'extension.json'), { name: 'extension.json' });

    // 添加图标（如果存在）
    const iconSrc = path.join(ROOT, 'icon.png');
    if (fs.existsSync(iconSrc)) {
      archive.file(iconSrc, { name: 'icon.png' });
    }

    // 添加编译后 JS（ZIP 内路径：dist/index.js，与 extension.json entry 对应）
    archive.file(compiledJs, { name: 'dist/index.js' });

    // 添加 iframe 目录：使用内联化后的 HTML（替换原版 index.html）
    archive.file(inlinedHtml, { name: 'iframe/index.html' });
    // callback.html 也需要内联（如果有外部脚本引用的话）
    const callbackSrc = path.join(iframeDir, 'callback.html');
    if (fs.existsSync(callbackSrc)) {
      archive.file(callbackSrc, { name: 'iframe/callback.html' });
    }

    archive.finalize();
  });

  const stats = fs.statSync(eextPath);
  console.log(`✅ 构建完成：build/dist/${eextName} (${stats.size} bytes)`);
  console.log('\n📦 .eext 内部结构：');
  console.log('   extension.json');
  console.log('   dist/index.js');
  console.log('   iframe/index.html');
  console.log('   iframe/app.js');
}

main().catch((err) => {
  console.error('❌ 构建失败：', err.message);
  process.exit(1);
});
