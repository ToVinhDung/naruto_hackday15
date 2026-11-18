const fs = require('node:fs');
const path = require('node:path');
const hre = require('hardhat');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const agentRelay = process.env.AGENT_RELAY_ADDRESS || deployer.address;

  console.log('Deploying EscrowCore to Avalanche Fuji (43113)...');
  console.log('Deployer:', deployer.address);
  console.log('AgentRelay:', agentRelay);

  const EscrowCore = await hre.ethers.getContractFactory('EscrowCore');
  const contract = await EscrowCore.deploy(agentRelay);
  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();
  const artifact = await hre.artifacts.readArtifact('EscrowCore');

  const outDir = path.resolve(__dirname, '..', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'fuji-deployment.json');

  const deploymentInfo = {
    network: 'fuji',
    chainId: 43113,
    contractName: 'EscrowCore',
    contractAddress,
    deployer: deployer.address,
    agentRelay,
    deployedAt: new Date().toISOString(),
    snowtraceAddressUrl: `https://testnet.snowtrace.io/address/${contractAddress}`,
    abi: artifact.abi
  };

  fs.writeFileSync(outPath, JSON.stringify(deploymentInfo, null, 2), 'utf8');
  console.log('Saved deployment info to:', outPath);
  console.log('Contract Address:', contractAddress);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

