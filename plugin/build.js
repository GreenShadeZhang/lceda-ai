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
    // 不设置 globalName，EDA 平台通过自身 loader 识别 registerFn
    logLevel: 'info',
  });
  console.log('✅ TypeScript → JavaScript 编译完成');

  // 3. 读取扩展配置
  const extConfig = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'extension.json'), 'utf-8')
  );
  const eextName = `${extConfig.name}-${extConfig.version}.eext`;
  const eextPath = path.join(DIST_DIR, eextName);

  // 4. 打包为 .eext（ZIP 文件）
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

    // 添加编译后 JS（ZIP 内路径：dist/index.js，与 extension.json entry 对应）
    archive.file(compiledJs, { name: 'dist/index.js' });

    // 添加 iframe 目录（ZIP 内路径：iframe/）
    archive.directory(path.join(ROOT, 'iframe'), 'iframe');

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
