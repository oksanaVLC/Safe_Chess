import type { MetadataRoute } from "next";

export const dynamic = "force-static";

/** Web app manifest: makes Safe Chess installable (brief §8, Step 6). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Safe Chess",
    short_name: "Safe Chess",
    description: "Chess for kids — and grown-ups too",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FAFAFA",
    theme_color: "#FAFAFA",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
