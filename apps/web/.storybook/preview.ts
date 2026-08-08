import type { Preview } from "@storybook/react-vite"

import "../src/runtime-core-fonts.css"
import "../src/runtime-fonts.css"
import "../src/styles.css"

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    controls: {
      expanded: true,
    },
    viewport: {
      options: {
        "launch-mobile": {
          name: "Launch Mobile 390",
          styles: {
            width: "390px",
            height: "844px",
          },
        },
        "data-replacement-mobile": {
          name: "Data Replacement Mobile 393",
          styles: {
            width: "393px",
            height: "852px",
          },
        },
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
        "canvas-desktop-editor": {
          name: "Canvas Editor Desktop 1440",
          styles: {
            width: "1440px",
            height: "900px",
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
