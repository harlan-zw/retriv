import antfu from '@antfu/eslint-config'

export default antfu({
  rules: {
    'no-use-before-define': 'off',
    'node/prefer-global/process': 'off',
    'node/prefer-global/buffer': 'off',
  },
}, {
  files: ['**/test/**/*.ts', '**/test/**/*.js'],
  rules: {
    'ts/no-unsafe-function-type': 'off',
    'no-console': 'off',
  },
})
