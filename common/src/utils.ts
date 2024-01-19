import { id } from 'ethers'
import {
  genTreeCommitment as genTallyResultCommitment,
  genRandomSalt,
  IncrementalQuinTree,
  hashLeftRight,
  hash5,
  hash3,
  hash2,
} from 'maci-crypto'
import { PubKey, PCommand, Message } from 'maci-domainobjs'
import { Keypair } from './keypair'
import { Tally } from './tally'

const LEAVES_PER_NODE = 5

export function bnSqrt(a: bigint): bigint {
  // Take square root from a bigint
  // https://stackoverflow.com/a/52468569/1868395
  if (a === 0n) {
    return a
  }
  let x: bigint
  let x1 = a / 2n
  do {
    x = x1
    x1 = (x + a / x) / 2n
  } while (x !== x1)
  return x
}

export function createMessage(
  userStateIndex: number,
  userKeypair: Keypair,
  newUserKeypair: Keypair | null,
  coordinatorPubKey: PubKey,
  voteOptionIndex: number | null,
  voiceCredits: bigint | null,
  nonce: number,
  pollId: bigint,
  salt?: bigint
): [Message, PubKey] {
  const encKeypair = newUserKeypair ? newUserKeypair : userKeypair
  if (!salt) {
    salt = genRandomSalt() as bigint
  }

  const quadraticVoteWeight = voiceCredits ? bnSqrt(voiceCredits) : 0n

  const command = new PCommand(
    BigInt(userStateIndex),
    encKeypair.pubKey,
    BigInt(voteOptionIndex || 0),
    quadraticVoteWeight,
    BigInt(nonce),
    pollId,
    salt
  )
  const signature = command.sign(userKeypair.privKey)
  const message = command.encrypt(
    signature,
    Keypair.genEcdhSharedKey(encKeypair.privKey, coordinatorPubKey)
  )
  return [message, encKeypair.pubKey]
}

export function getRecipientClaimData(
  recipientIndex: number,
  recipientTreeDepth: number,
  tally: Tally
): any[] {
  // Create proof for total amount of spent voice credits
  const spent = tally.perVOSpentVoiceCredits.tally[recipientIndex]
  const spentSalt = tally.perVOSpentVoiceCredits.salt
  const spentTree = new IncrementalQuinTree(
    recipientTreeDepth,
    BigInt(0),
    LEAVES_PER_NODE,
    hash5
  )
  for (const leaf of tally.perVOSpentVoiceCredits.tally) {
    spentTree.insert(BigInt(leaf))
  }
  const spentProof = spentTree.genProof(recipientIndex)

  const resultsCommitment = genTallyResultCommitment(
    tally.results.tally.map((x) => BigInt(x)),
    BigInt(tally.results.salt),
    recipientTreeDepth
  )

  const spentVoiceCreditsCommitment = hash2([
    BigInt(tally.totalSpentVoiceCredits.spent),
    BigInt(tally.totalSpentVoiceCredits.salt),
  ])

  return [
    recipientIndex,
    spent,
    spentProof.pathElements.map((x) => x.map((y) => y.toString())),
    spentSalt,
    resultsCommitment,
    spentVoiceCreditsCommitment,
  ]
}

/**
 * get the id of the subgraph public key entity from the pubKey value
 * @param pubKey MACI public key
 * @returns the id for the subgraph public key entity
 */
export function getPubKeyId(pubKey: PubKey): string {
  const pubKeyPair = pubKey.asContractParam()
  return id(pubKeyPair.x + '.' + pubKeyPair.y)
}

export {
  genTallyResultCommitment,
  Message,
  PCommand as Command,
  IncrementalQuinTree,
  hash5,
  hash2,
  hash3,
  hashLeftRight,
  LEAVES_PER_NODE,
}
