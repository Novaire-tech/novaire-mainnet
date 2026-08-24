import { rpc, Networks } from '@stellar/stellar-sdk';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const RPC_URL = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;
const DEPLOYMENTS_FILE = path.resolve(__dirname, 'deployments.testnet.json');

async function smokeTest() {
    if (!fs.existsSync(DEPLOYMENTS_FILE)) {
        throw new Error("No deployments found.");
    }
    const deployments = JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, 'utf-8'));
    
    const keys = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'testnet_keys.json'), 'utf-8'));
    const sourceAccount = keys.admin_secret;

    console.log("Running Smoke Test: Verifying Factory Registry...");
    const cmd = `stellar contract invoke --id ${deployments.factory} --source-account ${sourceAccount} --rpc-url ${RPC_URL} --network-passphrase "${NETWORK_PASSPHRASE}" -- get_epoch --epoch_id 1`;
    try {
        const out = execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
        if (out.includes(deployments.sy_wrapper)) {
            console.log("✅ Smoke Test Passed: Epoch 1 successfully queried and verified!");
            process.exit(0);
        } else {
            console.error("❌ Smoke Test Failed: Epoch 1 query did not return expected registry.");
            console.error(out);
            process.exit(1);
        }
    } catch(e: any) {
        console.error("❌ Smoke Test Failed: Could not query Factory.");
        console.error(e.stderr ? e.stderr.toString() : e.message);
        process.exit(1);
    }
}

smokeTest();
