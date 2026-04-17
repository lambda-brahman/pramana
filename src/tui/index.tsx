import { render } from "ink";
import { App } from "./app.tsx";
import type { DataSource } from "./data-source.ts";

export async function startTui(
  dataSource: DataSource,
  initialTenant: string,
  port: number,
): Promise<void> {
  const { waitUntilExit } = render(
    <App dataSource={dataSource} initialTenant={initialTenant} port={port} />,
  );
  await waitUntilExit();
}
