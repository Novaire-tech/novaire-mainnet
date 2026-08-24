import * as fs from 'fs';
import * as path from 'path';

// Stellar contract/account IDs are base32; an all-'A' body (after the C/G prefix) decodes
// to the zero-filled ID — the canonical "burn"/null address for this chain.
const ZERO_ADDRESS_PATTERN = /^[CG]A{20,}$|^0x0+$/i;
const PLACEHOLDER_PATTERN = /^(TODO|PLACEHOLDER|CHANGEME|UNSET|undefined|null)$/i;

/**
 * Fails deployment loudly rather than letting an undefined/empty/zero/placeholder
 * contract address reach a production `deploy_epoch` call. A silently-empty
 * BLEND_POOL or contract ID would otherwise deploy an epoch that can never
 * route funds correctly.
 */
export function assertRequiredAddresses(addresses: Record<string, string | undefined>): void {
    const problems: string[] = [];
    for (const [name, value] of Object.entries(addresses)) {
        if (value === undefined || value === null || value.trim() === '') {
            problems.push(`${name} is missing/empty`);
        } else if (ZERO_ADDRESS_PATTERN.test(value.trim())) {
            problems.push(`${name} is a zero/burn address: ${value}`);
        } else if (PLACEHOLDER_PATTERN.test(value.trim())) {
            problems.push(`${name} is a placeholder value: ${value}`);
        }
    }
    if (problems.length > 0) {
        throw new Error(
            `Refusing to deploy: required contract address(es) invalid:\n  - ${problems.join('\n  - ')}`
        );
    }
}

export function saveDeployments(dirname: string, deployments: Record<string, string>) {
    const data = JSON.stringify(deployments, null, 2);
    const network = (process.env.NETWORK || 'testnet').toLowerCase();
    
    // Save to scripts/
    const scriptsDeploymentsFile = path.resolve(dirname, `deployments.${network}.json`);
    fs.writeFileSync(scriptsDeploymentsFile, data);

    // Save to src/config/
    const frontendDeploymentsFile = path.resolve(dirname, `../src/config/deployments.${network}.json`);
    if (fs.existsSync(path.dirname(frontendDeploymentsFile))) {
        fs.writeFileSync(frontendDeploymentsFile, data);
    }
}
