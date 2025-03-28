import { ethers } from 'hardhat'
import { expect } from 'chai'
import { Contract, solidityPackedKeccak256 } from 'ethers'
import { gtcrEncode } from '@kleros/gtcr-encoder'
import { time } from '@nomicfoundation/hardhat-network-helpers'

import { UNIT, ZERO_ADDRESS } from '../utils/constants'
import { getTxFee, getEventArg } from '../utils/contracts'
import { deployContract } from '../utils/deployment'
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'

const MAX_RECIPIENTS = 15

async function getCurrentTime(): Promise<number> {
  return await time.latest()
}

function getRecipientId(
  registryAddress: string,
  address: string,
  metadata: string
): string {
  return solidityPackedKeccak256(
    ['address', 'address', 'string'],
    [registryAddress, address, metadata]
  )
}

describe('Simple Recipient Registry', async () => {
  let registry: Contract
  let registryAddress: string
  let deployer: HardhatEthersSigner
  let controller: HardhatEthersSigner
  let recipient: HardhatEthersSigner

  before(async () => {
    ;[, deployer, controller, recipient] = await ethers.getSigners()
  })

  beforeEach(async () => {
    const SimpleRecipientRegistry = await ethers.getContractFactory(
      'SimpleRecipientRegistry',
      deployer
    )
    registry = await SimpleRecipientRegistry.deploy(controller.address)
    registryAddress = await registry.getAddress()
  })

  describe('initializing and configuring', () => {
    it('initializes correctly', async () => {
      expect(await registry.controller()).to.equal(controller.address)
      expect(await registry.maxRecipients()).to.equal(0)
    })

    it('sets max number of recipients', async () => {
      await (registry.connect(controller) as Contract).setMaxRecipients(
        MAX_RECIPIENTS
      )
      expect(await registry.maxRecipients()).to.equal(MAX_RECIPIENTS)
    })

    it('reverts if given number is less than current limit', async () => {
      await (registry.connect(controller) as Contract).setMaxRecipients(
        MAX_RECIPIENTS
      )
      await expect(
        (registry.connect(controller) as Contract).setMaxRecipients(1)
      ).to.be.revertedWith(
        'RecipientRegistry: Max number of recipients can not be decreased'
      )
    })

    it('ignores attempt to set max number of recipients from anyone except controller', async () => {
      await registry.setMaxRecipients(MAX_RECIPIENTS)
      expect(await registry.maxRecipients()).to.equal(0)
    })

    it('should not add recipient if limit is not set', async () => {
      await expect(
        registry.addRecipient(recipient.address, JSON.stringify({}))
      ).to.be.revertedWith('RecipientRegistry: Recipient limit is not set')
    })
  })

  describe('managing recipients', () => {
    const recipientIndex = 1
    let recipientAddress: string
    let metadata: string
    let recipientId: string

    beforeEach(async () => {
      await (registry.connect(controller) as Contract).setMaxRecipients(
        MAX_RECIPIENTS
      )
      recipientAddress = recipient.address
      metadata = JSON.stringify({
        name: 'Recipient',
        description: 'Description',
        imageHash: 'Ipfs imageHash',
      })
      const registryAddress = await registry.getAddress()
      recipientId = getRecipientId(registryAddress, recipientAddress, metadata)
    })

    it('allows owner to add recipient', async () => {
      const recipientAdded = await registry.addRecipient(
        recipientAddress,
        metadata
      )
      let currentTime = await getCurrentTime()
      expect(recipientAdded)
        .to.emit(registry, 'RecipientAdded')
        .withArgs(
          recipientId,
          recipientAddress,
          metadata,
          recipientIndex,
          currentTime
        )
      expect(
        await registry.getRecipientAddress(
          recipientIndex,
          currentTime,
          currentTime
        )
      ).to.equal(recipientAddress)

      const anotherRecipientAddress =
        '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
      const anotherRecipientId = getRecipientId(
        registryAddress,
        anotherRecipientAddress,
        metadata
      )
      const anotherRecipientAdded = await registry.addRecipient(
        anotherRecipientAddress,
        metadata
      )
      currentTime = await getCurrentTime()
      // Should increase recipient index for every new recipient
      expect(anotherRecipientAdded)
        .to.emit(registry, 'RecipientAdded')
        .withArgs(
          anotherRecipientId,
          anotherRecipientAddress,
          metadata,
          recipientIndex + 1,
          currentTime
        )
    })

    it('rejects attempts to add recipient from anyone except owner', async () => {
      const registryAsRecipient = registry.connect(recipient) as Contract
      await expect(
        registryAsRecipient.addRecipient(recipientAddress, metadata)
      ).to.be.revertedWith('Ownable: caller is not the owner')
    })

    it('should not accept zero-address as recipient address', async () => {
      recipientAddress = ZERO_ADDRESS
      await expect(
        registry.addRecipient(recipientAddress, metadata)
      ).to.be.revertedWith('RecipientRegistry: Recipient address is zero')
    })

    it('should not accept empty string as recipient metadata', async () => {
      metadata = ''
      await expect(
        registry.addRecipient(recipientAddress, metadata)
      ).to.be.revertedWith('RecipientRegistry: Metadata info is empty string')
    })

    it('should not add already registered recipient', async () => {
      await registry.addRecipient(recipientAddress, metadata)
      await expect(
        registry.addRecipient(recipientAddress, metadata)
      ).to.be.revertedWith('RecipientRegistry: Recipient already registered')
    })

    it('should limit the number of recipients', async () => {
      let recipientName
      for (let i = 0; i < MAX_RECIPIENTS + 1; i++) {
        recipientName = String(i + 1).padStart(4, '0')
        metadata = JSON.stringify({
          name: recipientName,
          description: 'Description',
          imageHash: 'Ipfs imageHash',
        })
        recipientAddress = `0x000000000000000000000000000000000000${recipientName}`
        if (i < MAX_RECIPIENTS) {
          await registry.addRecipient(recipientAddress, metadata)
        } else {
          await expect(
            registry.addRecipient(recipientAddress, metadata)
          ).to.be.revertedWith('RecipientRegistry: Recipient limit reached')
        }
      }
    })

    it('allows owner to remove recipient', async () => {
      await registry.addRecipient(recipientAddress, metadata)
      const recipientRemoved = await registry.removeRecipient(recipientId)
      const currentTime = await getCurrentTime()
      expect(recipientRemoved)
        .to.emit(registry, 'RecipientRemoved')
        .withArgs(recipientId, currentTime)
      expect(
        await registry.getRecipientAddress(
          recipientIndex,
          currentTime,
          currentTime
        )
      ).to.equal(ZERO_ADDRESS)
    })

    it('rejects attempts to remove recipient from anyone except owner', async () => {
      const registryAsRecipient = registry.connect(recipient) as Contract
      await expect(
        registryAsRecipient.removeRecipient(recipientId)
      ).to.be.revertedWith('Ownable: caller is not the owner')
    })

    it('reverts if recipient is not in registry', async () => {
      recipientId = `0x${'0'.repeat(64)}`
      await expect(registry.removeRecipient(recipientId)).to.be.revertedWith(
        'RecipientRegistry: Recipient is not in the registry'
      )
    })

    it('should not remove already removed recipient', async () => {
      await registry.addRecipient(recipientAddress, metadata)
      await registry.removeRecipient(recipientId)
      await expect(registry.removeRecipient(recipientId)).to.be.revertedWith(
        'RecipientRegistry: Recipient already removed'
      )
    })

    it('should not return recipient address for recipient that has been added after the end of round', async () => {
      const startTime = await getCurrentTime()
      await time.increase(1000)
      const endTime = await getCurrentTime()
      await registry.addRecipient(recipientAddress, metadata)
      expect(
        await registry.getRecipientAddress(recipientIndex, startTime, endTime)
      ).to.equal(ZERO_ADDRESS)
    })

    it('should return recipient address for recipient that has been removed after the beginning of round', async () => {
      await registry.addRecipient(recipientAddress, metadata)
      const startTime = await getCurrentTime()
      await registry.removeRecipient(recipientId)
      await time.increase(1000)
      const endTime = await getCurrentTime()
      expect(
        await registry.getRecipientAddress(recipientIndex, startTime, endTime)
      ).to.equal(recipientAddress)
    })

    it('should return recipient count', async () => {
      expect(await registry.getRecipientCount()).to.equal(0)
      await registry.addRecipient(recipientAddress, metadata)
      expect(await registry.getRecipientCount()).to.equal(1)
      await registry.removeRecipient(recipientId)
      expect(await registry.getRecipientCount()).to.equal(0)
    })

    it('allows to re-use index of removed recipient', async () => {
      // Add recipients up to a limit
      for (let i = 0; i < MAX_RECIPIENTS; i++) {
        const recipientName = String(i + 1).padStart(4, '0')
        recipientAddress = `0x000000000000000000000000000000000000${recipientName}`
        await registry.addRecipient(recipientAddress, metadata)
      }
      const time1 = await getCurrentTime()

      // Replace recipients
      const removedRecipient1 = '0x0000000000000000000000000000000000000001'
      const removedRecipient1Id = getRecipientId(
        registryAddress,
        removedRecipient1,
        metadata
      )
      const removedRecipient2 = '0x0000000000000000000000000000000000000002'
      const removedRecipient2Id = getRecipientId(
        registryAddress,
        removedRecipient2,
        metadata
      )
      await registry.removeRecipient(removedRecipient1Id)
      await registry.removeRecipient(removedRecipient2Id)
      const addedRecipient1 = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
      const addedRecipient2 = '0xef9e07C93b40681F6a63085Cf276aBA3D868Ac6E'
      const addedRecipient3 = '0x927be3E75380CC412148AfE80d9e9D02fF488738'
      await registry.addRecipient(addedRecipient1, metadata)
      await registry.addRecipient(addedRecipient2, metadata)
      await expect(
        registry.addRecipient(addedRecipient3, metadata)
      ).to.be.revertedWith('RecipientRegistry: Recipient limit reached')
      const time2 = await getCurrentTime()

      // Recipients removed during the round should still be valid
      expect(await registry.getRecipientAddress(1, time1, time2)).to.equal(
        removedRecipient1
      )
      expect(await registry.getRecipientAddress(2, time1, time2)).to.equal(
        removedRecipient2
      )

      await time.increase(1000)
      const time3 = await getCurrentTime()
      // Recipients removed before the beginning of the round should be replaced
      expect(await registry.getRecipientAddress(1, time2, time3)).to.equal(
        addedRecipient2
      )
      expect(await registry.getRecipientAddress(2, time2, time3)).to.equal(
        addedRecipient1
      )
    })
  })

  describe('get recipient address', () => {
    it('should return zero address for zero index', async () => {
      const currentTime = await getCurrentTime()
      expect(
        await registry.getRecipientAddress(0, currentTime, currentTime)
      ).to.equal(ZERO_ADDRESS)
    })

    it('should return zero address for unregistered recipient', async () => {
      const currentTime = await getCurrentTime()
      expect(
        await registry.getRecipientAddress(99, currentTime, currentTime)
      ).to.equal(ZERO_ADDRESS)
    })
  })
})

describe('Kleros GTCR adapter', () => {
  let tcr: Contract
  let registry: Contract
  let deployer: HardhatEthersSigner
  let controller: HardhatEthersSigner
  let recipient: HardhatEthersSigner
  let tcrAddress: string

  const gtcrColumns = [
    {
      label: 'Name',
      description: 'Commonly recognizable name of the recipient.',
      type: 'text',
      isIdentifier: true,
    },
    {
      label: 'Address',
      description: 'Recipient receiving address',
      type: 'address',
      isIdentifier: true,
    },
  ]

  function encodeRecipient(address: string): [string, string] {
    const recipientData = gtcrEncode({
      columns: gtcrColumns,
      values: { Name: `test-${address}`, Address: address },
    })
    const recipientId = solidityPackedKeccak256(['bytes'], [recipientData])
    return [recipientId, recipientData]
  }

  before(async () => {
    ;[, deployer, controller, recipient] = await ethers.getSigners()
  })

  beforeEach(async () => {
    const KlerosGTCRMock = await ethers.getContractFactory(
      'KlerosGTCRMock',
      deployer
    )
    tcr = await KlerosGTCRMock.deploy('/ipfs/0', '/ipfs/1')
    tcrAddress = await tcr.getAddress()
    const KlerosGTCRAdapter = await ethers.getContractFactory(
      'KlerosGTCRAdapter',
      deployer
    )
    registry = await KlerosGTCRAdapter.deploy(tcrAddress, controller.address)
  })

  it('initializes correctly', async () => {
    expect(await registry.tcr()).to.equal(tcrAddress)
    expect(await registry.controller()).to.equal(controller.address)
    expect(await registry.maxRecipients()).to.equal(0)
  })

  describe('managing recipients', () => {
    const recipientIndex = 1
    let recipientId: string
    let recipientData: string

    before(async () => {
      ;[recipientId, recipientData] = encodeRecipient(recipient.address)
    })

    beforeEach(async () => {
      await (registry.connect(controller) as Contract).setMaxRecipients(
        MAX_RECIPIENTS
      )
    })

    it('allows anyone to add recipient', async () => {
      await tcr.addItem(recipientData)
      const recipientAdded = await (
        registry.connect(recipient) as Contract
      ).addRecipient(recipientId)
      let currentTime = await getCurrentTime()
      expect(recipientAdded)
        .to.emit(registry, 'RecipientAdded')
        .withArgs(recipientId, recipientData, recipientIndex, currentTime)
      expect(
        await registry.getRecipientAddress(
          recipientIndex,
          currentTime,
          currentTime
        )
      ).to.equal(recipient.address)

      const anotherRecipientAddress =
        '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
      const [anotherRecipientId, anotherRecipientData] = encodeRecipient(
        anotherRecipientAddress
      )
      await tcr.addItem(anotherRecipientData)
      const anotherRecipientAdded = await (
        registry.connect(recipient) as Contract
      ).addRecipient(anotherRecipientId)
      currentTime = await getCurrentTime()
      // Should increase recipient index for every new recipient
      expect(anotherRecipientAdded)
        .to.emit(registry, 'RecipientAdded')
        .withArgs(
          anotherRecipientId,
          anotherRecipientData,
          recipientIndex + 1,
          currentTime
        )
    })

    it('should not accept recipient who is not registered in TCR', async () => {
      await expect(registry.addRecipient(recipientId)).to.be.revertedWith(
        'RecipientRegistry: Item not found in TCR'
      )
    })

    it('should not add already registered recipient', async () => {
      await tcr.addItem(recipientData)
      await registry.addRecipient(recipientId)
      await expect(registry.addRecipient(recipientId)).to.be.revertedWith(
        'RecipientRegistry: Recipient already registered'
      )
    })

    it('should not accept recipient with invalid metadata', async () => {
      await tcr.addItem('0xdead')
      await expect(registry.addRecipient(recipientId)).to.be.reverted
    })

    it('allows anyone to remove recipient', async () => {
      await tcr.addItem(recipientData)
      await (registry.connect(recipient) as Contract).addRecipient(recipientId)
      await tcr.removeItem(recipientId)
      const recipientRemoved = await (
        registry.connect(recipient) as Contract
      ).removeRecipient(recipientId)
      const currentTime = await getCurrentTime()
      expect(recipientRemoved)
        .to.emit(registry, 'RecipientRemoved')
        .withArgs(recipientId, currentTime)
      expect(
        await registry.getRecipientAddress(
          recipientIndex,
          currentTime,
          currentTime
        )
      ).to.equal(ZERO_ADDRESS)
    })

    it('should not remove already removed recipient', async () => {
      await tcr.addItem(recipientData)
      await registry.addRecipient(recipientId)
      await tcr.removeItem(recipientId)
      await registry.removeRecipient(recipientId)
      await expect(registry.removeRecipient(recipientId)).to.be.revertedWith(
        'RecipientRegistry: Recipient already removed'
      )
    })

    it('should not remove removed recipient who has not been removed from TCR', async () => {
      await tcr.addItem(recipientData)
      await registry.addRecipient(recipientId)
      await expect(registry.removeRecipient(recipientId)).to.be.revertedWith(
        'RecipientRegistry: Item is not removed from TCR'
      )
    })
  })

  describe('get recipient address', () => {
    async function addRecipient(address: string) {
      const [recipientId, recipientData] = encodeRecipient(address)
      await tcr.addItem(recipientData)
      return await registry.addRecipient(recipientId)
    }

    async function removeRecipient(address: string) {
      const [recipientId] = encodeRecipient(address)
      await tcr.removeItem(recipientId)
      return await registry.removeRecipient(recipientId)
    }

    beforeEach(async () => {
      await (registry.connect(controller) as Contract).setMaxRecipients(
        MAX_RECIPIENTS
      )
    })

    it('allows to re-use index of removed recipient', async () => {
      // Add recipients up to a limit
      for (let i = 0; i < MAX_RECIPIENTS; i++) {
        const recipientName = String(i + 1).padStart(4, '0')
        const recipientAddress = `0x100000000000000000000000000000000000${recipientName}`
        await addRecipient(recipientAddress)
      }
      const time1 = await getCurrentTime()

      // Replace recipients
      const removedRecipient1 = '0x1000000000000000000000000000000000000001'
      const removedRecipient2 = '0x1000000000000000000000000000000000000002'
      await removeRecipient(removedRecipient1)
      await removeRecipient(removedRecipient2)
      const addedRecipient1 = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
      const addedRecipient2 = '0xef9e07C93b40681F6a63085Cf276aBA3D868Ac6E'
      const addedRecipient3 = '0x927be3E75380CC412148AfE80d9e9D02fF488738'
      await addRecipient(addedRecipient1)
      await addRecipient(addedRecipient2)
      await expect(addRecipient(addedRecipient3)).to.be.revertedWith(
        'RecipientRegistry: Recipient limit reached'
      )
      const time2 = await getCurrentTime()

      // Recipients removed during the round should still be valid
      expect(await registry.getRecipientAddress(1, time1, time2)).to.equal(
        removedRecipient1
      )
      expect(await registry.getRecipientAddress(2, time1, time2)).to.equal(
        removedRecipient2
      )

      time.increase(1000)
      const time3 = await getCurrentTime()
      // Recipients removed before the beginning of the round should be replaced
      expect(await registry.getRecipientAddress(1, time2, time3)).to.equal(
        addedRecipient2
      )
      expect(await registry.getRecipientAddress(2, time2, time3)).to.equal(
        addedRecipient1
      )
    })
  })
})

describe('Optimistic recipient registry', () => {
  let registry: Contract
  let registryAddress: string

  let deployer: HardhatEthersSigner
  let controller: HardhatEthersSigner
  let recipient: HardhatEthersSigner
  let requester: HardhatEthersSigner

  const baseDeposit = UNIT / 10n // 0.1 ETH
  const challengePeriodDuration = 86400 // Seconds

  enum RequestType {
    Registration = 0,
    Removal = 1,
  }

  before(async () => {
    ;[, deployer, controller, recipient, requester] = await ethers.getSigners()
  })
  beforeEach(async () => {
    registry = await deployContract({
      name: 'OptimisticRecipientRegistry',
      contractArgs: [baseDeposit, challengePeriodDuration, controller.address],
      ethers,
      signer: deployer,
    })
    registryAddress = await registry.getAddress()
  })

  it('initializes correctly', async () => {
    expect(await registry.baseDeposit()).to.equal(baseDeposit)
    expect(await registry.challengePeriodDuration()).to.equal(
      challengePeriodDuration
    )
    expect(await registry.controller()).to.equal(controller.address)
    expect(await registry.maxRecipients()).to.equal(0)
  })

  it('changes base deposit', async () => {
    const newBaseDeposit = baseDeposit * 2n
    await registry.setBaseDeposit(newBaseDeposit)
    expect(await registry.baseDeposit()).to.equal(newBaseDeposit)
  })

  it('changes challenge period duration', async () => {
    const newChallengePeriodDuration = challengePeriodDuration * 2
    await registry.setChallengePeriodDuration(newChallengePeriodDuration)
    expect(await registry.challengePeriodDuration()).to.equal(
      newChallengePeriodDuration
    )
  })

  describe('managing recipients', () => {
    const recipientIndex = 1
    let recipientAddress: string
    let metadata: string
    let recipientId: string

    beforeEach(async () => {
      await (registry.connect(controller) as Contract).setMaxRecipients(
        MAX_RECIPIENTS
      )
      recipientAddress = recipient.address
      metadata = JSON.stringify({
        name: 'Recipient',
        description: 'Description',
        imageHash: 'Ipfs imageHash',
      })
      recipientId = getRecipientId(registryAddress, recipientAddress, metadata)
    })

    it('allows anyone to submit registration request', async () => {
      const requestSubmitted = await (
        registry.connect(requester) as Contract
      ).addRecipient(recipientAddress, metadata, { value: baseDeposit })
      const currentTime = await getCurrentTime()
      expect(requestSubmitted)
        .to.emit(registry, 'RequestSubmitted')
        .withArgs(
          recipientId,
          RequestType.Registration,
          recipientAddress,
          metadata,
          currentTime
        )
      expect(await ethers.provider.getBalance(registryAddress)).to.equal(
        baseDeposit
      )
    })

    it('should not accept zero-address as recipient address', async () => {
      recipientAddress = ZERO_ADDRESS
      await expect(
        registry.addRecipient(recipientAddress, metadata, {
          value: baseDeposit,
        })
      ).to.be.revertedWith('RecipientRegistry: Recipient address is zero')
    })

    it('should not accept empty string as recipient metadata', async () => {
      metadata = ''
      await expect(
        registry.addRecipient(recipientAddress, metadata, {
          value: baseDeposit,
        })
      ).to.be.revertedWith('RecipientRegistry: Metadata info is empty string')
    })

    it('should not accept registration request if recipient is already registered', async () => {
      await registry.addRecipient(recipientAddress, metadata, {
        value: baseDeposit,
      })
      await time.increase(86400)
      await registry.executeRequest(recipientId)
      await expect(
        registry.addRecipient(recipientAddress, metadata, {
          value: baseDeposit,
        })
      ).to.be.revertedWith('RecipientRegistry: Recipient already registered')
    })

    it('should not accept new registration request if previous request is not resolved', async () => {
      await registry.addRecipient(recipientAddress, metadata, {
        value: baseDeposit,
      })
      await expect(
        registry.addRecipient(recipientAddress, metadata, {
          value: baseDeposit,
        })
      ).to.be.revertedWith('RecipientRegistry: Request already submitted')
    })

    it('should not accept registration request with incorrect deposit size', async () => {
      await expect(
        registry.addRecipient(recipientAddress, metadata, {
          value: baseDeposit / 2n,
        })
      ).to.be.revertedWith('RecipientRegistry: Incorrect deposit amount')
    })

    it('allows owner to challenge registration request', async () => {
      await (registry.connect(requester) as Contract).addRecipient(
        recipientAddress,
        metadata,
        { value: baseDeposit }
      )
      const requesterBalanceBefore = await ethers.provider.getBalance(
        requester.address
      )
      const requestRejected = await registry.challengeRequest(
        recipientId,
        requester.address
      )
      const currentTime = await getCurrentTime()
      expect(requestRejected)
        .to.emit(registry, 'RequestResolved')
        .withArgs(recipientId, RequestType.Registration, true, 0, currentTime)
      const requesterBalanceAfter = await ethers.provider.getBalance(
        requester.address
      )
      expect(requesterBalanceBefore + baseDeposit).to.equal(
        requesterBalanceAfter
      )
    })

    it('allows owner to set beneficiary address when challenging request', async () => {
      await registry.addRecipient(recipientAddress, metadata, {
        value: baseDeposit,
      })
      const controllerBalanceBefore = await ethers.provider.getBalance(
        controller.address
      )
      await registry.challengeRequest(recipientId, controller.address)
      const controllerBalanceAfter = await ethers.provider.getBalance(
        controller.address
      )
      expect(controllerBalanceBefore + baseDeposit).to.equal(
        controllerBalanceAfter
      )
    })

    it('allows only owner to challenge requests', async () => {
      await (registry.connect(requester) as Contract).addRecipient(
        recipientAddress,
        metadata,
        { value: baseDeposit }
      )
      await expect(
        (registry.connect(requester) as Contract).challengeRequest(
          recipientId,
          requester.address
        )
      ).to.be.revertedWith('Ownable: caller is not the owner')
    })

    it('should not allow to challenge resolved request', async () => {
      await (registry.connect(requester) as Contract).addRecipient(
        recipientAddress,
        metadata,
        { value: baseDeposit }
      )
      await registry.challengeRequest(recipientId, requester.address)
      await expect(
        registry.challengeRequest(recipientId, requester.address)
      ).to.be.revertedWith('RecipientRegistry: Request does not exist')
    })

    it('allows anyone to execute unchallenged registration request', async () => {
      await (registry.connect(requester) as Contract).addRecipient(
        recipientAddress,
        metadata,
        { value: baseDeposit }
      )
      await time.increase(86400)

      const requesterBalanceBefore = await ethers.provider.getBalance(
        requester.address
      )
      const requestExecuted = await (
        registry.connect(requester) as Contract
      ).executeRequest(recipientId)
      const currentTime = await getCurrentTime()
      expect(requestExecuted)
        .to.emit(registry, 'RequestResolved')
        .withArgs(
          recipientId,
          RequestType.Registration,
          false,
          recipientIndex,
          currentTime
        )
      const txFee = await getTxFee(requestExecuted)
      const requesterBalanceAfter = await ethers.provider.getBalance(
        requester.address
      )
      expect(requesterBalanceBefore - txFee + baseDeposit).to.equal(
        requesterBalanceAfter
      )

      expect(
        await registry.getRecipientAddress(
          recipientIndex,
          currentTime,
          currentTime
        )
      ).to.equal(recipientAddress)
    })

    it('should not allow to execute request that does not exist', async () => {
      await expect(registry.executeRequest(recipientId)).to.be.revertedWith(
        'RecipientRegistry: Request does not exist'
      )
    })

    it('should not allow non-owner to execute request during challenge period', async () => {
      await registry.addRecipient(recipientAddress, metadata, {
        value: baseDeposit,
      })

      await expect(
        (registry.connect(requester) as Contract).executeRequest(recipientId)
      ).to.be.revertedWith('RecipientRegistry: Challenge period is not over')
    })

    it('should allow owner to execute request during challenge period', async () => {
      await registry.addRecipient(recipientAddress, metadata, {
        value: baseDeposit,
      })

      let recipientCount = await registry.getRecipientCount()
      expect(Number(recipientCount)).to.equal(0)

      await registry.executeRequest(recipientId)

      recipientCount = await registry.getRecipientCount()
      expect(Number(recipientCount)).to.equal(1)
    })

    it('should remember initial deposit amount during registration', async () => {
      await (registry.connect(requester) as Contract).addRecipient(
        recipientAddress,
        metadata,
        { value: baseDeposit }
      )
      await registry.setBaseDeposit(baseDeposit * 2n)
      await time.increase(86400)

      const requesterBalanceBefore = await ethers.provider.getBalance(
        requester.address
      )
      const requestExecuted = await (
        registry.connect(requester) as Contract
      ).executeRequest(recipientId)
      const txFee = await getTxFee(requestExecuted)
      const requesterBalanceAfter = await ethers.provider.getBalance(
        requester.address
      )
      expect(requesterBalanceBefore - txFee + baseDeposit).to.equal(
        requesterBalanceAfter
      )
    })

    it('should limit the number of recipients', async () => {
      let recipientName
      for (let i = 0; i < MAX_RECIPIENTS + 1; i++) {
        recipientName = String(i + 1).padStart(4, '0')
        metadata = JSON.stringify({
          name: recipientName,
          description: 'Description',
          imageHash: 'Ipfs imageHash',
        })
        recipientAddress = `0x000000000000000000000000000000000000${recipientName}`
        recipientId = getRecipientId(
          registryAddress,
          recipientAddress,
          metadata
        )
        if (i < MAX_RECIPIENTS) {
          await registry.addRecipient(recipientAddress, metadata, {
            value: baseDeposit,
          })
          await time.increase(86400)
          await registry.executeRequest(recipientId)
        } else {
          await registry.addRecipient(recipientAddress, metadata, {
            value: baseDeposit,
          })
          await time.increase(86400)
          await expect(registry.executeRequest(recipientId)).to.be.revertedWith(
            'RecipientRegistry: Recipient limit reached'
          )
        }
      }
    })

    it('allows owner to submit removal request', async () => {
      await registry.addRecipient(recipientAddress, metadata, {
        value: baseDeposit,
      })
      await time.increase(86400)
      await registry.executeRequest(recipientId)

      const requestSubmitted = await registry.removeRecipient(recipientId, {
        value: baseDeposit,
      })
      const currentTime = await getCurrentTime()
      expect(requestSubmitted)
        .to.emit(registry, 'RequestSubmitted')
        .withArgs(
          recipientId,
          RequestType.Removal,
          ZERO_ADDRESS,
          '',
          currentTime
        )
    })

    it('allows only owner to execute removal request during challenge period', async () => {
      await registry.addRecipient(recipientAddress, metadata, {
        value: baseDeposit,
      })
      await registry.executeRequest(recipientId)

      const registryAsRequester = registry.connect(requester) as Contract
      await registryAsRequester.removeRecipient(recipientId, {
        value: baseDeposit,
      })

      await expect(
        registryAsRequester.executeRequest(recipientId)
      ).to.be.revertedWith('RecipientRegistry: Challenge period is not over')
    })

    it('should not accept removal request if recipient is not in registry', async () => {
      await expect(registry.removeRecipient(recipientId)).to.be.revertedWith(
        'RecipientRegistry: Recipient is not in the registry'
      )
    })

    it('should not accept removal request if recipient is already removed', async () => {
      await registry.addRecipient(recipientAddress, metadata, {
        value: baseDeposit,
      })
      await time.increase(86400)
      await registry.executeRequest(recipientId)

      await registry.removeRecipient(recipientId, { value: baseDeposit })
      await time.increase(86400)
      await (registry.connect(requester) as Contract).executeRequest(
        recipientId
      )

      await expect(registry.removeRecipient(recipientId)).to.be.revertedWith(
        'RecipientRegistry: Recipient already removed'
      )
    })

    it('should not accept new removal request if previous removal request is not resolved', async () => {
      await registry.addRecipient(recipientAddress, metadata, {
        value: baseDeposit,
      })
      await time.increase(86400)
      await registry.executeRequest(recipientId)

      await registry.removeRecipient(recipientId, { value: baseDeposit })
      await expect(registry.removeRecipient(recipientId)).to.be.revertedWith(
        'RecipientRegistry: Request already submitted'
      )
    })

    it('allows owner to challenge removal request', async () => {
      await registry.addRecipient(recipientAddress, metadata, {
        value: baseDeposit,
      })
      await time.increase(86400)
      await registry.executeRequest(recipientId)

      await registry.removeRecipient(recipientId, { value: baseDeposit })
      const requestRejected = await registry.challengeRequest(
        recipientId,
        requester.address
      )
      const currentTime = await getCurrentTime()
      expect(requestRejected)
        .to.emit(registry, 'RequestResolved')
        .withArgs(recipientId, RequestType.Removal, true, 0, currentTime)

      // Recipient is not removed
      expect(
        await registry.getRecipientAddress(
          recipientIndex,
          currentTime,
          currentTime
        )
      ).to.equal(recipientAddress)
    })

    it('allows anyone to execute unchallenged removal request', async () => {
      await registry.addRecipient(recipientAddress, metadata, {
        value: baseDeposit,
      })
      await time.increase(86400)
      await registry.executeRequest(recipientId)

      await registry.removeRecipient(recipientId, { value: baseDeposit })
      await time.increase(86400)

      const requestExecuted = await (
        registry.connect(requester) as Contract
      ).executeRequest(recipientId)
      const currentTime = await getCurrentTime()
      expect(requestExecuted)
        .to.emit(registry, 'RequestResolved')
        .withArgs(recipientId, RequestType.Removal, false, 0, currentTime)

      expect(
        await registry.getRecipientAddress(
          recipientIndex,
          currentTime,
          currentTime
        )
      ).to.equal(ZERO_ADDRESS)
    })

    it('creates different recipient id for different recipient registries', async () => {
      const txOne = await registry.addRecipient(recipientAddress, metadata, {
        value: baseDeposit,
      })
      const idOne = await getEventArg(
        txOne,
        registry,
        'RequestSubmitted',
        '_recipientId'
      )

      const anotherRegistry = await deployContract({
        name: 'OptimisticRecipientRegistry',
        contractArgs: [
          baseDeposit,
          challengePeriodDuration,
          controller.address,
        ],
        ethers,
        signer: deployer,
      })
      const txTwo = await anotherRegistry.addRecipient(
        recipientAddress,
        metadata,
        {
          value: baseDeposit,
        }
      )
      const idTwo = await getEventArg(
        txTwo,
        anotherRegistry,
        'RequestSubmitted',
        '_recipientId'
      )

      expect(idOne.length).to.be.gt(0)
      expect(idTwo.length).to.be.gt(0)
      expect(idOne).to.not.eq(idTwo)
    })
  })
})
