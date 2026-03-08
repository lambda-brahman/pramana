import { render } from "ink";
import { App } from "./app.tsx";
import type { DataSource } from "./data-source.ts";

export async function startTui(dataSource: DataSource, initialTenant: string): Promise<void> {
  const { waitUntilExit } = render(<App dataSource={dataSource} initialTenant={initialTenant} />);
  await waitUntilExit();
}
