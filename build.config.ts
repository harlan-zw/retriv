import { defineBuildConfig } from 'obuild/config'

export default defineBuildConfig({
  entries: [
    {
      type: 'bundle',
      input: [
        './src/index.ts',
        './src/model.ts',
        './src/drivers/sqlite-vec.ts',
        './src/drivers/libsql.ts',
        './src/drivers/upstash.ts',
        './src/drivers/cloudflare.ts',
        './src/drivers/pgvector.ts',
      ],
    },
  ],
})
