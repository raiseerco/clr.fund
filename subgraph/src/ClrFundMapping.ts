/* eslint-disable @typescript-eslint/ban-types */
import { Address, BigInt, log } from '@graphprotocol/graph-ts'
import {
  ClrFund,
  ContributorRegistry,
  FundingRound,
  Poll,
  RecipientRegistry,
  Token,
} from '../generated/schema'
import {
  ClrFund as ClrFundContract,
  CoordinatorChanged,
  FundingSourceAdded,
  FundingSourceRemoved,
  OwnershipTransferred,
  RecipientRegistryChanged,
  RoundFinalized,
  RoundStarted,
  TokenChanged,
  UserRegistryChanged,
} from '../generated/ClrFund/ClrFund'
import {
  FundingRound as FundingRoundTemplate,
  MACI as MACITemplate,
  Poll as PollTemplate,
  OptimisticRecipientRegistry as recipientRegistryTemplate,
} from '../generated/templates'

import { BrightIdUserRegistry as BrightIdUserRegistryContract } from '../generated/ClrFund/BrightIdUserRegistry'
import { FundingRound as FundingRoundContract } from '../generated/ClrFund/FundingRound'
import { MACI as MACIContract } from '../generated/ClrFund/MACI'
import { MACIFactory as MACIFactoryContract } from '../generated/ClrFund/MACIFactory'
import { Poll as PollContract } from '../generated/ClrFund/Poll'
import { OptimisticRecipientRegistry as RecipientRegistryContract } from '../generated/ClrFund/OptimisticRecipientRegistry'
import { Token as TokenContract } from '../generated/ClrFund/Token'
import { createRecipientRegistry } from './RecipientRegistry'

function createContributorRegistry(
  clrFundAddress: Address,
  contributorRegistryAddress: Address
): ContributorRegistry {
  log.info('New contributorRegistry', [])

  const owner = clrFundAddress
  const contributorRegistryId = contributorRegistryAddress.toHexString()

  const brightIdUserRegistryContract = BrightIdUserRegistryContract.bind(
    contributorRegistryAddress
  )
  const brightIdSponsorCall = brightIdUserRegistryContract.try_brightIdSponsor()
  const contributorRegistry = new ContributorRegistry(contributorRegistryId)
  contributorRegistry.context = brightIdSponsorCall.reverted
    ? 'BrightId user registry'
    : 'simple user registry'
  contributorRegistry.owner = owner
  contributorRegistry.clrFund = clrFundAddress.toHexString()
  contributorRegistry.save()

  return contributorRegistry
}

function createToken(tokenAddress: Address, blockTimestamp: BigInt): Token {
  const tokenId = tokenAddress.toHexString()
  const token = new Token(tokenId)
  const tokenContract = TokenContract.bind(tokenAddress)

  const symbol = tokenContract.try_symbol()
  const decimals = tokenContract.try_decimals()

  if (!symbol.reverted) {
    token.symbol = symbol.value
  }

  if (!decimals.reverted) {
    token.decimals = BigInt.fromI32(decimals.value)
  }

  const timestamp = blockTimestamp.toString()
  token.createdAt = timestamp
  token.lastUpdatedAt = timestamp
  token.tokenAddress = tokenAddress
  token.save()

  return token
}

function createOrUpdateClrFund(
  clrFundAddress: Address,
  timestamp: BigInt
): ClrFund {
  const clrFundId = clrFundAddress.toHexString()

  const clrFundContract = ClrFundContract.bind(clrFundAddress)

  const loadedClrFund = ClrFund.load(clrFundId)
  const clrFund = loadedClrFund ? loadedClrFund : new ClrFund(clrFundId)

  const maciFactoryAddressCall = clrFundContract.try_maciFactory()
  if (maciFactoryAddressCall.reverted) {
    log.info('TRY maciFactoryAddress Failed', [])
  } else {
    const maciFactoryAddress = maciFactoryAddressCall.value
    const maciFactoryContract = MACIFactoryContract.bind(maciFactoryAddress)

    const stateTreeDepth = maciFactoryContract.stateTreeDepth()
    const messageTreeDepth = maciFactoryContract.treeDepths().value2
    const voteOptionTreeDepth = maciFactoryContract.treeDepths().value3

    clrFund.maciFactory = maciFactoryAddress
    clrFund.messageTreeDepth = BigInt.fromI32(messageTreeDepth)
    clrFund.stateTreeDepth = BigInt.fromI32(stateTreeDepth)
    clrFund.voteOptionTreeDepth = BigInt.fromI32(voteOptionTreeDepth)

    log.info('New maciFactoryAddress', [])
  }

  const nativeToken = clrFundContract.nativeToken()
  const nativeTokenId = nativeToken.toHexString()
  const nativeTokenEntity = Token.load(nativeTokenId)
  if (!nativeTokenEntity) {
    createToken(nativeToken, timestamp)
  }

  const coordinator = clrFundContract.coordinator()
  const owner = clrFundContract.owner()

  //Check if these registries already exist/are being tracked
  const recipientRegistryAddress = clrFundContract.recipientRegistry()
  const recipientRegistryId = recipientRegistryAddress.toHexString()
  const recipientRegistry = RecipientRegistry.load(recipientRegistryId)
  if (!recipientRegistry) {
    createRecipientRegistry(clrFundId, recipientRegistryAddress)
  }

  const contributorRegistryAddress = clrFundContract.userRegistry()
  const contributorRegistryId = contributorRegistryAddress.toHexString()
  const contributorRegistry = ContributorRegistry.load(contributorRegistryId)
  if (!contributorRegistry) {
    createContributorRegistry(clrFundAddress, contributorRegistryAddress)
  }

  clrFund.contributorRegistry = contributorRegistryId
  clrFund.recipientRegistry = recipientRegistryId
  clrFund.contributorRegistryAddress = contributorRegistryAddress
  clrFund.recipientRegistryAddress = recipientRegistryAddress
  clrFund.nativeToken = nativeToken
  clrFund.nativeTokenInfo = nativeTokenId
  clrFund.coordinator = coordinator
  clrFund.owner = owner

  clrFund.save()
  return clrFund
}

export function handleCoordinatorChanged(event: CoordinatorChanged): void {
  log.info('handleCoordinatorChanged', [])
  createOrUpdateClrFund(event.address, event.block.timestamp)
}

export function handleFundingSourceAdded(event: FundingSourceAdded): void {
  log.info('handleFundingSourceAdded', [])
  createOrUpdateClrFund(event.address, event.block.timestamp)
}

export function handleFundingSourceRemoved(event: FundingSourceRemoved): void {
  log.info('handleFundingSourceRemoved', [])
}

export function handleOwnershipTransferred(event: OwnershipTransferred): void {
  log.info('handleOwnershipTransferred', [event.params.newOwner.toHexString()])
  createOrUpdateClrFund(event.address, event.block.timestamp)
}

export function handleRoundFinalized(event: RoundFinalized): void {
  log.info('handleRoundFinalized', [])
  const fundingRoundAddress = event.params._round

  const fundingRoundContract = FundingRoundContract.bind(fundingRoundAddress)

  const fundingRound = new FundingRound(fundingRoundAddress.toHexString())

  const totalSpent = fundingRoundContract.totalSpent()
  const totalVotes = fundingRoundContract.totalVotes()
  const tallyHash = fundingRoundContract.tallyHash()
  const isFinalized = fundingRoundContract.isFinalized()
  const isCancelled = fundingRoundContract.isCancelled()
  const contributorCount = fundingRoundContract.contributorCount()
  const matchingPoolSize = fundingRoundContract.matchingPoolSize()

  fundingRound.totalSpent = totalSpent
  fundingRound.totalVotes = totalVotes
  fundingRound.tallyHash = tallyHash
  fundingRound.isFinalized = isFinalized
  fundingRound.isCancelled = isCancelled
  fundingRound.contributorCount = contributorCount
  fundingRound.matchingPoolSize = matchingPoolSize

  fundingRound.save()
}

export function handleRoundStarted(event: RoundStarted): void {
  log.info('handleRoundStarted!!!', [])
  const clrFundId = event.address.toHexString()
  const fundingRoundId = event.params._round.toHexString()

  const clrFund = createOrUpdateClrFund(event.address, event.block.timestamp)

  FundingRoundTemplate.create(event.params._round)
  const fundingRoundAddress = event.params._round
  const fundingRoundContract = FundingRoundContract.bind(fundingRoundAddress)
  const fundingRound = new FundingRound(fundingRoundId)

  log.info('Get all the things', [])
  const nativeToken = fundingRoundContract.nativeToken()
  const nativeTokenId = nativeToken.toHexString()
  const nativeTokenEntity = Token.load(nativeTokenId)
  if (!nativeTokenEntity) {
    createToken(nativeToken, event.block.timestamp)
  }
  const coordinator = fundingRoundContract.coordinator()
  const maci = fundingRoundContract.maci()
  const voiceCreditFactor = fundingRoundContract.voiceCreditFactor()
  const contributorCount = fundingRoundContract.contributorCount()
  const matchingPoolSize = fundingRoundContract.matchingPoolSize()

  MACITemplate.create(maci)

  fundingRound.clrFund = clrFundId
  fundingRound.nativeToken = nativeToken
  fundingRound.nativeTokenInfo = nativeTokenId
  fundingRound.coordinator = coordinator
  fundingRound.maci = maci
  fundingRound.maciTxHash = event.transaction.hash
  fundingRound.voiceCreditFactor = voiceCreditFactor
  fundingRound.contributorCount = contributorCount
  fundingRound.matchingPoolSize = matchingPoolSize
  fundingRound.startTime = event.block.timestamp

  const recipientRegistryId = clrFund.recipientRegistry
  const recipientRegistryAddress = clrFund.recipientRegistryAddress

  const contributorRegistryId = clrFund.contributorRegistry
  const contributorRegistryAddress = clrFund.contributorRegistryAddress

  const maciContract = MACIContract.bind(maci)
  const stateTreeDepth = maciContract.try_stateTreeDepth()
  if (!stateTreeDepth.reverted) {
    fundingRound.stateTreeDepth = stateTreeDepth.value
  }

  log.info('TRY pollAddress', [])
  const pollIdCall = fundingRoundContract.try_pollId()
  if (!pollIdCall.reverted) {
    fundingRound.pollId = pollIdCall.value
  }

  const pollAddressCall = fundingRoundContract.try_poll()
  if (pollAddressCall.reverted) {
    log.info('TRY pollAddress Failed', [])
  } else {
    const pollAddress = pollAddressCall.value
    fundingRound.pollAddress = pollAddress
    PollTemplate.create(pollAddress)

    const pollEntityId = pollAddress.toHexString()
    const pollEntity = new Poll(pollEntityId)
    pollEntity.fundingRound = fundingRoundId
    pollEntity.save()

    const pollContract = PollContract.bind(pollAddress)
    const deployTimeAndDuration = pollContract.try_getDeployTimeAndDuration()
    if (!deployTimeAndDuration.reverted) {
      const deployTime = deployTimeAndDuration.value.value0
      const duration = deployTimeAndDuration.value.value1
      // MACI's signup deadline is the same as the voting deadline
      fundingRound.signUpDeadline = deployTime.plus(duration)
      fundingRound.votingDeadline = fundingRound.signUpDeadline
      fundingRound.startTime = deployTime

      log.info('New pollAddress', [])
    }

    const treeDepths = pollContract.try_treeDepths()
    if (!treeDepths.reverted) {
      fundingRound.messageTreeDepth = treeDepths.value.value2
      fundingRound.voteOptionTreeDepth = treeDepths.value.value3
    }

    const coordinatorPubKey = pollContract.try_coordinatorPubKey()
    if (!coordinatorPubKey.reverted) {
      fundingRound.coordinatorPubKeyX = coordinatorPubKey.value.value0
      fundingRound.coordinatorPubKeyY = coordinatorPubKey.value.value1
    }
  }

  clrFund.currentRound = fundingRoundId

  clrFund.save()

  //NOTE: Set the registries for the round
  fundingRound.contributorRegistry = contributorRegistryId
  fundingRound.recipientRegistry = recipientRegistryId
  fundingRound.contributorRegistryAddress = contributorRegistryAddress
  fundingRound.recipientRegistryAddress = recipientRegistryAddress
  fundingRound.recipientCount = BigInt.fromString('0')

  fundingRound.save()
}

export function handleTokenChanged(event: TokenChanged): void {
  log.info('handleTokenChanged {}', [event.params._token.toHexString()])
  createOrUpdateClrFund(event.address, event.block.timestamp)
}

export function handleRecipientRegistryChanged(
  event: RecipientRegistryChanged
): void {
  log.info('handleRecipientRegistryChanged {}', [
    event.params._recipientRegistry.toHexString(),
  ])
  createOrUpdateClrFund(event.address, event.block.timestamp)
}

export function handleUserRegistryChanged(event: UserRegistryChanged): void {
  log.info('handleUserRegistryChanged {}', [
    event.params._userRegistry.toHexString(),
  ])
  createOrUpdateClrFund(event.address, event.block.timestamp)
}
