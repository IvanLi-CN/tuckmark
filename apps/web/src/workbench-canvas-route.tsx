import React from "react"

import type { CanvasStoryScenario } from "./canvas-editor-model.js"
import { CanvasWorkspace, preloadCanvasWorkspaceRouteData } from "./canvas-page.js"
import type { WorkbenchController } from "./workbench-controller.js"

export async function preloadCanvasRouteNavigation(pathname: string): Promise<void> {
  await preloadCanvasWorkspaceRouteData(pathname)
}

export default function WorkbenchCanvasRoute({
  controller,
  initialScenario,
  onRouteChunkReady,
}: {
  controller: WorkbenchController
  initialScenario?: CanvasStoryScenario
  onRouteChunkReady?: () => void
}) {
  React.useEffect(() => {
    onRouteChunkReady?.()
  }, [onRouteChunkReady])

  return <CanvasWorkspace controller={controller} initialScenario={initialScenario} />
}
