/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const nodeExternals = require('webpack-node-externals');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
  mode: 'production',
  externals: [nodeExternals()], 
  externalsPresets: {
    node: true, 
  },
  entry: './app.ts',
  output: {
    filename: 'app.bundle.js',
    path: path.resolve(__dirname, 'dist'),
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          compress: {},
          mangle: true,
          ecma: 2017,
          enclose: false,
          keep_classnames: false,
          keep_fnames: false,
          ie8: false,
          nameCache: null,
          safari10: false,
          toplevel: true,
        },
      }),
    ],
  },
  plugins: [new CleanWebpackPlugin()],
};
