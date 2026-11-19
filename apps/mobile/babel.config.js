module.exports = {
  presets: ['babel-preset-expo'],
  // __E2E__, __E2E_API_URL__, __E2E_BRIDGE_URL__ (README "Cloud / e2e build").
  plugins: ['./babel/inline-e2e-env'],
};
