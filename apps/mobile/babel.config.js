// Previously absent: Expo's Metro applied `babel-preset-expo` (which pulls in
// the react-native-worklets/reanimated transform and the React Compiler) by
// default. Now that we need `babel-plugin-inline-import` to inline Drizzle's
// `.sql` migration files into the bundle, the preset must be declared
// explicitly so those transforms are preserved.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [["inline-import", { extensions: [".sql"] }]],
  };
};
