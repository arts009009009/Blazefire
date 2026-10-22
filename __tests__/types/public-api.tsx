import Blazefire, {
  BLAZEFIRE_VERSION,
  BlazefireProvider,
  createCompiler as createRootCompiler,
} from 'blazefire'
import { createCompiler as createSubpathCompiler } from 'blazefire/compiler'

const rootCompiler = createRootCompiler({ target: 'es2022' })
const transformResult: Promise<{ code: string }> = rootCompiler.transform(
  'const value: number = 1'
)

const subpathCompiler = createSubpathCompiler({ target: 'es2022' })
const compileResult: Promise<{ code: string; error: null }> =
  subpathCompiler.compile('const value: number = 1')

const version: string = Blazefire.version
const namedVersion: string = BLAZEFIRE_VERSION
const provider: typeof BlazefireProvider = Blazefire.BlazefireProvider

void transformResult
void compileResult
void version
void namedVersion
void provider
