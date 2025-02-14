import { isScalar, SCALAR } from '../nodes/identity.ts'
import { Scalar } from '../nodes/Scalar.ts'
import type { BlockScalar, FlowScalar, SourceToken } from '../parse/cst.ts'
import type { Schema } from '../schema/Schema.ts'
import type { ScalarTag } from '../schema/types.ts'
import type { ComposeContext } from './compose-node.ts'
import type { ComposeErrorHandler } from './composer.ts'
import { resolveBlockScalar } from './resolve-block-scalar.ts'
import { resolveFlowScalar } from './resolve-flow-scalar.ts'

export function composeScalar(
  ctx: ComposeContext,
  token: FlowScalar | BlockScalar,
  tagToken: SourceToken | null,
  onError: ComposeErrorHandler
) {
  const { value, type, comment, range } =
    token.type === 'block-scalar'
      ? resolveBlockScalar(ctx, token, onError)
      : resolveFlowScalar(token, ctx.options.strict, onError)

  const tagName = tagToken
    ? ctx.directives.tagName(tagToken.source, msg =>
        onError(tagToken, 'TAG_RESOLVE_FAILED', msg)
      )
    : null

  let tag: ScalarTag
  if (ctx.options.stringKeys && ctx.atKey) {
    tag = ctx.schema[SCALAR]
  } else if (tagName)
    tag = findScalarTagByName(ctx.schema, value, tagName, tagToken!, onError)
  else if (token.type === 'scalar')
    tag = findScalarTagByTest(ctx, value, token, onError)
  else tag = ctx.schema[SCALAR]

  let scalar: Scalar
  try {
    const res = tag.resolve(
      value,
      msg => onError(tagToken ?? token, 'TAG_RESOLVE_FAILED', msg),
      ctx.options
    )
    scalar = isScalar(res) ? res : new Scalar(res)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    onError(tagToken ?? token, 'TAG_RESOLVE_FAILED', msg)
    scalar = new Scalar(value)
  }
  scalar.range = range
  scalar.source = value
  if (type) scalar.type = type
  if (tagName) scalar.tag = tagName
  if (tag.format) scalar.format = tag.format
  if (comment) scalar.comment = comment

  return scalar as Scalar.Parsed
}

function findScalarTagByName(
  schema: Schema,
  value: string,
  tagName: string,
  tagToken: SourceToken,
  onError: ComposeErrorHandler
) {
  if (tagName === '!') return schema[SCALAR] // non-specific tag
  const matchWithTest: ScalarTag[] = []
  for (const tag of schema.tags) {
    if (!tag.collection && tag.tag === tagName) {
      if (tag.default && tag.test) matchWithTest.push(tag)
      else return tag
    }
  }
  for (const tag of matchWithTest) if (tag.test?.test(value)) return tag
  const kt = schema.knownTags[tagName]
  if (kt && !kt.collection) {
    // Ensure that the known tag is available for stringifying,
    // but does not get used by default.
    schema.tags.push(Object.assign({}, kt, { default: false, test: undefined }))
    return kt
  }
  onError(
    tagToken,
    'TAG_RESOLVE_FAILED',
    `Unresolved tag: ${tagName}`,
    tagName !== 'tag:yaml.org,2002:str'
  )
  return schema[SCALAR]
}

function findScalarTagByTest(
  { atKey, directives, schema }: ComposeContext,
  value: string,
  token: FlowScalar,
  onError: ComposeErrorHandler
) {
  const tag =
    (schema.tags.find(
      tag =>
        (tag.default === true || (atKey && tag.default === 'key')) &&
        tag.test?.test(value)
    ) as ScalarTag) || schema[SCALAR]

  if (schema.compat) {
    const compat =
      schema.compat.find(tag => tag.default && tag.test?.test(value)) ??
      schema[SCALAR]
    if (tag.tag !== compat.tag) {
      const ts = directives.tagString(tag.tag)
      const cs = directives.tagString(compat.tag)
      const msg = `Value may be parsed as either ${ts} or ${cs}`
      onError(token, 'TAG_RESOLVE_FAILED', msg, true)
    }
  }

  return tag
}
