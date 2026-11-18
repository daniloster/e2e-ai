# Example reports

`2026-11-18-benchmark-ci-4vcpu-16gb.zip` — the two model benchmarks in the main README, as the tool
wrote them (screenshots halved and palette-compressed to keep the archive small; 46 MB → 6 MB).

| Folder in the zip | Target | Models × modes |
|---|---|---|
| `20261118-224036-web-playwright-mcp-benchmark/` | web via Playwright (`@playwright/mcp`, headless Chrome) | qwen3-vl:4b, qwen3:4b, qwen3.5:4b × no-cache, cache, one-fresh |
| `20261118-230001-android-appium-benchmark/` | Android 15 emulator via Appium (UiAutomator2) | same |

Machine: 4 vCPU / 16 GB Linux container, CPU only (a GitHub-CI-sized runner). Every model started
from an empty plan cache. Open `index.html` in each folder for the comparison; each model's run
reports (with step screenshots) are under `models/<model>/<mode>/index.html`.

```sh
unzip 2026-11-18-benchmark-ci-4vcpu-16gb.zip -d /tmp/e2e-benchmarks && open /tmp/e2e-benchmarks/*/index.html
```
