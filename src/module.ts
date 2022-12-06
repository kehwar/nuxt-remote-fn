import { fileURLToPath } from 'url'
import { addImports, addServerHandler, addTemplate, addVitePlugin, defineNuxtModule } from '@nuxt/kit'
import fg from 'fast-glob'
import { join } from 'pathe'
import dedent from 'dedent'
import { createFilter } from '@rollup/pluginutils'
import { getModuleId, transformServerFiles } from './runtime/transformer'

export interface ModuleOptions {
  pattern?: string | string[]
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-remote-fn',
    configKey: 'remoteFn'
  },
  defaults: {
    pattern: '**/*.server.{ts,js,mjs}'
  },
  async setup (options, nuxt) {
    const files: string[] = []

    const filter = createFilter(options.pattern)

    // Transpile runtime and handler
    const handlerPath = join(nuxt.options.buildDir, 'remote-event-handler.ts')
    const runtimeDir = fileURLToPath(new URL('./runtime', import.meta.url))
    nuxt.options.build.transpile.push(runtimeDir)

    nuxt.hook('builder:watch', async (e, path) => {
      if (e === 'change') { return }
      if (filter(path)) {
        await scanRemoteFunctions()
        await nuxt.callHook('builder:generateApp')
      }
    })

    addServerHandler({
      route: '/api/__remote/:moduleId/:functionName',
      method: 'post',
      handler: handlerPath
    })

    addVitePlugin(transformServerFiles({ filter }))

    addImports({
      name: 'callRemoteFunction',
      as: 'callRemoteFunction',
      from: join(runtimeDir, 'client')
    })

    await scanRemoteFunctions()

    addTemplate({
      filename: 'remote-event-handler.ts',
      write: true,
      getContents () {
        const filesWithId = files.map(file => ({
          file: file.replace(/\.ts$/, ''),
          id: getModuleId(file)
        }))
        return dedent`
          import { createRemoteFnHandler } from '${join(runtimeDir, 'server')}'
          ${filesWithId.map(i => `import * as ${i.id} from '${i.file}'`).join('\n')}
          export default createRemoteFnHandler({
            ${filesWithId.map(i => i.id).join(',\n')}
          })
        `
      }
    })

    async function scanRemoteFunctions () {
      files.length = 0
      const updatedFiles = await fg(options.pattern!, {
        cwd: nuxt.options.srcDir,
        absolute: true,
        onlyFiles: true,
        ignore: ['!**/node_modules', '!**/.nuxt', '!**/dist', '!**/.output']
      })
      files.push(...new Set(updatedFiles))
      return files
    }
  }
})
