import { createFileRoute } from "@tanstack/react-router";
import { Viewer } from "@/components/Viewer";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "v-dicom — Visualizador DICOM, MPR 3D e STL no navegador" },
      {
        name: "description",
        content:
          "Abra tomografias DICOM/CBCT no navegador: cortes axial, coronal e sagital, reconstrução 3D e visualização de modelos STL. Os arquivos nunca saem do seu computador.",
      },
      { property: "og:title", content: "v-dicom — Visualizador DICOM, MPR 3D e STL" },
      {
        property: "og:description",
        content:
          "Cortes axial, coronal e sagital, reconstrução 3D e modelos STL direto no navegador, com privacidade total.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Viewer,
});
