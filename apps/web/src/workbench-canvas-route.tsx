import type { CanvasStoryScenario } from "./canvas-editor-model.js"
import { CanvasWorkspace, preloadCanvasWorkspaceRouteData } from "./canvas-page.js"
import type { LoadedCanvasRouteData } from "./canvas-route-data.js"
import type { WorkbenchController } from "./workbench-controller.js"

export async function preloadCanvasRouteNavigation(pathname: string): Promise<void> {
  await preloadCanvasWorkspaceRouteData(pathname)
}

export default function WorkbenchCanvasRoute({
  controller,
  draftProcessing,
  initialScenario,
  initialLoadedRouteData,
}: {
  controller: WorkbenchController
  draftProcessing?: boolean
  initialScenario?: CanvasStoryScenario
  initialLoadedRouteData?: LoadedCanvasRouteData
}) {
  return (
    <CanvasWorkspace
      controller={controller}
      draftProcessing={draftProcessing}
      initialScenario={initialScenario}
      initialLoadedRouteData={initialLoadedRouteData}
    />
  )
}
