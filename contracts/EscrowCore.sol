// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title EscrowCore
 * @notice Hạ tầng Smart Contract Escrow cho Avalanche Fuji Testnet (Chain ID 43113):
 *         - WorkAgreement: lưu client, freelancer, baselineHash và trạng thái ký 2 bên.
 *         - MilestoneEscrow: khóa AVAX theo từng milestone, chỉ client/arbitrator được giải ngân; chặn agentRelay.
 *         - ProofRegistry: chỉ agentRelay được ghi bằng chứng nghiệm thu qua recordVerification().
 */
contract EscrowCore {
    struct WorkAgreement {
        address client;
        address freelancer;
        address arbitrator;
        bytes32 baselineHash;
        bool clientSigned;
        bool freelancerSigned;
        bool exists;
    }

    struct MilestoneEscrow {
        uint256 agreementId;
        uint256 amount;
        bool funded;
        bool released;
    }

    struct ProofRecord {
        bytes32 deliverableHash;
        bytes32 testReportHash;
        uint8 score;
        uint256 timestamp;
        bool exists;
    }

    address public owner;
    address public agentRelay;

    mapping(uint256 => WorkAgreement) public agreements;
    mapping(uint256 => MilestoneEscrow) public milestones;
    mapping(uint256 => ProofRecord) public proofs;

    event AgreementCreated(
        uint256 indexed agreementId,
        address indexed client,
        address indexed freelancer,
        bytes32 baselineHash
    );
    event AgreementSigned(uint256 indexed agreementId, address indexed signer);
    event MilestoneFunded(uint256 indexed agreementId, uint256 indexed milestoneId, uint256 amount);
    event MilestoneReleased(uint256 indexed milestoneId, address indexed recipient, uint256 amount);
    event ProofAnchored(uint256 indexed milestoneId, bytes32 testReportHash, uint8 score);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyAgentRelay() {
        require(msg.sender == agentRelay, "Only agentRelay can record verification");
        _;
    }

    constructor(address _agentRelay) {
        require(_agentRelay != address(0), "Invalid agentRelay");
        owner = msg.sender;
        agentRelay = _agentRelay;
    }

    function setAgentRelay(address _newRelay) external onlyOwner {
        require(_newRelay != address(0), "Invalid agentRelay");
        agentRelay = _newRelay;
    }

    function createAgreement(
        uint256 agreementId,
        address freelancer,
        address arbitrator,
        bytes32 baselineHash
    ) external {
        require(!agreements[agreementId].exists, "Agreement already exists");
        require(freelancer != address(0) && arbitrator != address(0), "Invalid participants");
        require(freelancer != msg.sender && arbitrator != msg.sender && arbitrator != freelancer, "Conflict of interest");

        agreements[agreementId] = WorkAgreement({
            client: msg.sender,
            freelancer: freelancer,
            arbitrator: arbitrator,
            baselineHash: baselineHash,
            clientSigned: true,
            freelancerSigned: false,
            exists: true
        });

        emit AgreementCreated(agreementId, msg.sender, freelancer, baselineHash);
    }

    function signAgreement(uint256 agreementId) external {
        WorkAgreement storage agr = agreements[agreementId];
        require(agr.exists, "Agreement not found");
        require(msg.sender == agr.client || msg.sender == agr.freelancer, "Not a party");

        if (msg.sender == agr.client) {
            agr.clientSigned = true;
        } else {
            agr.freelancerSigned = true;
        }
        emit AgreementSigned(agreementId, msg.sender);
    }

    function fundMilestone(uint256 agreementId, uint256 milestoneId) external payable {
        WorkAgreement storage agr = agreements[agreementId];
        require(agr.exists, "Agreement not found");
        require(msg.sender == agr.client, "Only client can fund");
        require(msg.value > 0, "Must lock > 0 AVAX");
        require(!milestones[milestoneId].funded, "Milestone already funded");

        milestones[milestoneId] = MilestoneEscrow({
            agreementId: agreementId,
            amount: msg.value,
            funded: true,
            released: false
        });

        emit MilestoneFunded(agreementId, milestoneId, msg.value);
    }

    function releaseMilestone(uint256 milestoneId) external {
        require(msg.sender != agentRelay, "AgentRelay cannot release funds");
        MilestoneEscrow storage ms = milestones[milestoneId];
        require(ms.funded && !ms.released, "Milestone not releasable");

        WorkAgreement storage agr = agreements[ms.agreementId];
        require(agr.clientSigned && agr.freelancerSigned, "Requires 2-party signature");
        require(msg.sender == agr.client || msg.sender == agr.arbitrator, "Only client or arbitrator");

        ms.released = true;
        uint256 payout = ms.amount;
        (bool sent, ) = payable(agr.freelancer).call{value: payout}("");
        require(sent, "AVAX transfer failed");

        emit MilestoneReleased(milestoneId, agr.freelancer, payout);
    }

    function recordVerification(
        uint256 milestoneId,
        bytes32 deliverableHash,
        bytes32 testReportHash,
        uint8 score
    ) external onlyAgentRelay {
        require(score <= 100, "Score out of range");

        proofs[milestoneId] = ProofRecord({
            deliverableHash: deliverableHash,
            testReportHash: testReportHash,
            score: score,
            timestamp: block.timestamp,
            exists: true
        });

        emit ProofAnchored(milestoneId, testReportHash, score);
    }

    function getProof(uint256 milestoneId) external view returns (ProofRecord memory) {
        return proofs[milestoneId];
    }
}

