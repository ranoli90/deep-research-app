const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.extraNodeModules = {
  "@deep/design": path.resolve(workspaceRoot, "packages/design"),
  "@deep/contracts": path.resolve(workspaceRoot, "packages/contracts"),
};
// NodeNext uses .js specifiers for TS sources. Only the public workspace contract
// package needs Metro's extension probing; third-party and native resolution stay standard.
const contractsSource = path.resolve(workspaceRoot, "packages/contracts/src") + path.sep;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const name = context.originModulePath.startsWith(contractsSource) && moduleName.startsWith(".") && moduleName.endsWith(".js")
    ? moduleName.slice(0, -3) : moduleName;
  return context.resolveRequest(context, name, platform);
};
module.exports = config;
