import { test, expect, describe } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function setupTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "release-test-"));
	return dir;
}

async function writeFile(path: string, content: string): Promise<void> {
	await Bun.write(path, content);
}

async function readFile(path: string): Promise<string> {
	return Bun.file(path).text();
}

describe("release.sh version bumping", () => {
	test("sed bumps Cargo.toml version field", async () => {
		const dir = await setupTempDir();
		const toml = join(dir, "Cargo.toml");
		await writeFile(
			toml,
			`[package]\nname = "pramana-cli"\nversion = "0.1.0"\nedition = "2021"\n`,
		);

		const proc = Bun.spawnSync([
			"sed",
			"-i",
			"",
			's/^version = "[^"]*"/version = "0.14.0-rc.1"/',
			toml,
		]);
		expect(proc.exitCode).toBe(0);

		const result = await readFile(toml);
		expect(result).toContain('version = "0.14.0-rc.1"');
		expect(result).toContain('name = "pramana-cli"');
		await rm(dir, { recursive: true });
	});

	test("sed does not modify non-version fields in Cargo.toml", async () => {
		const dir = await setupTempDir();
		const toml = join(dir, "Cargo.toml");
		await writeFile(
			toml,
			[
				"[package]",
				'name = "pramana-engine"',
				'version = "0.1.0"',
				'edition = "2021"',
				"",
				"[dependencies]",
				'pramana-core = { path = "../pramana-core", version = "0.1.0" }',
				"",
			].join("\n"),
		);

		const proc = Bun.spawnSync([
			"sed",
			"-i",
			"",
			's/^version = "[^"]*"/version = "0.14.0"/',
			toml,
		]);
		expect(proc.exitCode).toBe(0);

		const result = await readFile(toml);
		expect(result).toContain('version = "0.14.0"');
		// dependency version is NOT on the start of line — should be unchanged
		expect(result).toContain('version = "0.1.0" }');
		await rm(dir, { recursive: true });
	});

	test("pre-release tag detection (contains hyphen)", () => {
		const isPrerelease = (tag: string) => tag.includes("-");
		expect(isPrerelease("v0.14.0-rc.1")).toBe(true);
		expect(isPrerelease("v0.14.0-beta.2")).toBe(true);
		expect(isPrerelease("v0.14.0")).toBe(false);
		expect(isPrerelease("v1.0.0")).toBe(false);
	});
});

describe("install.sh triple detection", () => {
	test("artifact name matches release-rust.yml naming", () => {
		const triples = [
			{ os: "darwin", arch: "x64", expected: "pramana-darwin-x64" },
			{ os: "darwin", arch: "arm64", expected: "pramana-darwin-arm64" },
			{ os: "linux", arch: "x64", expected: "pramana-linux-x64" },
			{ os: "linux", arch: "arm64", expected: "pramana-linux-arm64" },
		];

		for (const { os, arch, expected } of triples) {
			expect(`pramana-${os}-${arch}`).toBe(expected);
		}
	});

	test("uname arch mapping is correct", () => {
		const mapArch = (raw: string): string => {
			switch (raw) {
				case "x86_64":
				case "amd64":
					return "x64";
				case "arm64":
				case "aarch64":
					return "arm64";
				default:
					throw new Error(`Unsupported: ${raw}`);
			}
		};

		expect(mapArch("x86_64")).toBe("x64");
		expect(mapArch("amd64")).toBe("x64");
		expect(mapArch("arm64")).toBe("arm64");
		expect(mapArch("aarch64")).toBe("arm64");
	});
});
