import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { AssistantOverlay, AssistantRight } from './components'
import { BrowserRuntime, type ConnectionFace, type ModelDirectoryFace } from './runtime'
import { STYLE_TEXT } from './styles'
import { AssistantSettings } from './settings'

export const name = 'input-assistant.client'
export const inject = ['slots', 'connection', 'modelDirectories']

/** Slot registration stays inside the mounted fiber; unloading owns all timers and DOM. */
export function apply(ctx: Context): void {
  const connection = ctx.get('connection') as unknown as ConnectionFace
  const models = ctx.get('modelDirectories' as never) as ModelDirectoryFace | undefined
  const runtime = new BrowserRuntime(connection, models)
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshInputAssistant = ''
    style.textContent = STYLE_TEXT
    document.head.append(style)
    return () => { runtime.dispose(); style.remove() }
  }, 'input-assistant: browser lifetime')
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right', id: 'input-assistant', order: 40,
    inject: () => ({ runtime }),
  }, AssistantRight))
  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay', id: 'input-assistant', order: 40,
    inject: () => ({ runtime }),
  }, AssistantOverlay))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'input-assistant', order: 65, label: '输入助手',
    inject: () => ({ runtime }),
  }, AssistantSettings))
}

export { BrowserRuntime, InputAssistantController } from './public'
