import type { Preview } from "@storybook/react-vite"

import "../src/styles.css"

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    controls: {
      expanded: true,
    },
    viewport: {
      options: {
        "template-single-outlet": {
          name: "Template Single Outlet 1100",
          styles: {
            width: "1100px",
            height: "820px",
          },
        },
        "template-stacked-preview": {
          name: "Template Stacked Preview 930",
          styles: {
            width: "930px",
            height: "820px",
          },
        },
        "canvas-wide-editor": {
          name: "Canvas Editor 1280",
          styles: {
            width: "1280px",
            height: "800px",
          },
        },
        "canvas-narrow-editor": {
          name: "Canvas Editor 1100",
          styles: {
            width: "1100px",
            height: "820px",
          },
        },
      },
    },
  },
}

export default preview
