// Adapted for Reizo Studio from Presenton (Apache-2.0). See this vendor directory's LICENSE, NOTICE and UPSTREAM.json for provenance and modifications.
export const CHART_BROWSER_SCRIPT_URL = "/vendor/chart-4.5.1.umd.min.js";
export const CHART_DATALABELS_SCRIPT_URL =
  "/vendor/chartjs-plugin-datalabels-2.2.0.min.js";

export type ChartDatasetLike = {
  backgroundColor?: unknown;
  data?: unknown;
  [key: string]: unknown;
};

export type ChartConfigurationLike = {
  data?: {
    datasets?: ChartDatasetLike[];
    labels?: unknown;
    [key: string]: unknown;
  };
  options?: Record<string, unknown>;
  plugins?: unknown[];
  type?: unknown;
};

export type ChartInstanceLike = {
  destroy(): void;
  update(mode?: string): void;
};

export type ChartConstructorLike = {
  new (
    item: HTMLCanvasElement,
    config: ChartConfigurationLike,
  ): ChartInstanceLike;
  getChart(item: HTMLCanvasElement): ChartInstanceLike | undefined;
  register(...plugins: unknown[]): void;
};

export type DataLabelsContextLike = {
  chart: {
    getDatasetMeta(datasetIndex: number): { type?: unknown };
  };
  dataIndex: number;
  dataset: ChartDatasetLike;
  datasetIndex: number;
};

export type ChartBrowserRuntime = {
  Chart: ChartConstructorLike;
  ChartDataLabels: unknown;
};

let pending: Promise<ChartBrowserRuntime> | undefined;
export function loadChartBrowserRuntime(): Promise<ChartBrowserRuntime> {
  return pending ??= Promise.all([import('chart.js/auto'), import('chartjs-plugin-datalabels')]).then(([chart, labels]) => {
    chart.Chart.register(labels.default);
    return { Chart: chart.Chart as unknown as ChartConstructorLike, ChartDataLabels: labels.default };
  });
}
