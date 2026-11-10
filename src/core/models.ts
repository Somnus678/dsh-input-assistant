/** Read-only model choices for the plugin's auxiliary route, independent of the main composer. */
export interface AssistantModelCatalog {
  groups: { provider: string; name: string; models: { id: string; name: string }[] }[]
  failures: { provider: string; name: string }[]
}
