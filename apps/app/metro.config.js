const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');
const rootReact = path.resolve(monorepoRoot, 'node_modules/react');

const config = getDefaultConfig(projectRoot);
// api-client / dto 是 exports 指向 ESM dist 的包，必须开启 package exports 解析
config.resolver.unstable_enablePackageExports = true;
// hoisted monorepo：根上是 app 的 react@19.1.0，web/react-query 另嵌 19.2.8。
// 不钉死解析的话 QueryClientProvider 会 invalid hook call。
config.watchFolders = [monorepoRoot];
config.resolver.disableHierarchicalLookup = true;
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];
config.resolver.extraNodeModules = {
  react: rootReact,
};
module.exports = config;
