import type { Plane } from "@/lib/dicom";
import type { SceneSummary } from "@/lib/wp";

/**
 * Correção manual da orientação do volume: quais eixos estão espelhados.
 * Exames CBCT sem tags de orientação confiáveis podem abrir invertidos
 * (de cabeça para baixo / espelhados); estes flags são aplicados aos dados do
 * volume ao carregar e ficam salvos nas configurações da cena compartilhada.
 */
export type FlipFlags = { x: boolean; y: boolean; z: boolean };

/** Progresso de download de uma cena compartilhada (barra + bytes/velocidade). */
export type DownloadProgress = {
  done: number;
  total: number;
  receivedBytes: number;
  totalBytes: number;
  speedBps: number;
};

/** Aba de viewport exibida no mobile (um plano em foco por vez). */
export type PlaneTabKey = Plane | "3d";

/** Categoria ativa da navegação inferior (mobile). */
export type ViewerSheet = "cortes" | "janela" | "3d" | "modelos" | "anotar";

/** Segmentação recém-iniciada, exibida no diálogo de progresso. */
export type SegmentationProgressState = {
  key: string;
  title: string;
  startAt: number;
  typeId?: string;
};

/** Cena para a qual o usuário precisa escolher o tipo de segmentação. */
export type SegmentationPickerState = {
  key: string;
  title: string;
  summary: SceneSummary | null;
};
