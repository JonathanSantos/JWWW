import { z } from 'zod'

/**
 * Um override nunca é uma cópia local do arquivo: guardamos o snapshot do
 * original + o texto editado. Na interceptação o diff (original -> editado)
 * é reaplicado sobre o corpo que o servidor acabou de entregar. Se o arquivo
 * mudou no servidor, tentamos fuzzy-patch; se não aplicar, servimos o
 * original intacto e avisamos o dev.
 */
export const OverrideEntrySchema = z.object({
  id: z.string(),
  /** URL onde o override foi criado — usada para exibir e reabrir no editor */
  url: z.string(),
  /**
   * Quando presente, o casamento é por glob em vez de URL exata. É o que faz o
   * override sobreviver a bundles com hash no nome (`app.a3f9b1.js`).
   */
  pattern: z.string().optional(),
  kind: z.enum(['edit', 'expose']),
  enabled: z.boolean().default(true),
  contentType: z.enum(['js', 'css', 'html', 'other']).default('js'),
  originalHash: z.string(),
  originalText: z.string(),
  /** kind === 'edit' */
  editedText: z.string().optional(),
  /** kind === 'expose': seleção ancorada por contexto que vira globalThis[name] */
  expose: z
    .object({
      name: z.string(),
      selection: z.string(),
      prefix: z.string(),
      suffix: z.string()
    })
    .optional(),
  updatedAt: z.number()
})
export type OverrideEntry = z.infer<typeof OverrideEntrySchema>

export const UserScriptSchema = z.object({
  id: z.string(),
  name: z.string(),
  matches: z.array(z.string()).min(1),
  runAt: z.enum(['document-start', 'document-end']).default('document-end'),
  code: z.string(),
  enabled: z.boolean().default(true),
  updatedAt: z.number()
})
export type UserScript = z.infer<typeof UserScriptSchema>

export const NetRuleSchema = z.object({
  id: z.string(),
  pattern: z.string().min(1),
  action: z.enum(['block']),
  enabled: z.boolean().default(true)
})
export type NetRule = z.infer<typeof NetRuleSchema>

export const BusEmitSchema = z.object({
  topic: z.string().min(1).max(256),
  data: z.unknown()
})

/** Snapshot completo do ambiente de trabalho: overrides + scripts + regras. */
export const WorkspaceSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  createdAt: z.number(),
  overrides: z.array(OverrideEntrySchema),
  scripts: z.array(UserScriptSchema),
  rules: z.array(NetRuleSchema)
})
export type Workspace = z.infer<typeof WorkspaceSchema>

/** Formato do arquivo exportado — versionado para migrações futuras. */
export const WorkspaceFileSchema = z.object({
  jwww: z.literal(1),
  workspace: WorkspaceSchema
})
