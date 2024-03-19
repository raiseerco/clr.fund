import { FundingRound, Message, Poll, PublicKey } from '../generated/schema'

import { PublishMessage } from '../generated/templates/Poll/Poll'
import { log } from '@graphprotocol/graph-ts'
import { makePublicKeyId } from './PublicKey'

export function handlePublishMessage(event: PublishMessage): void {
  if (!event.transaction.to) {
    log.error(
      'Error: handlePublishMessage failed fundingRound not registered',
      []
    )
    return
  }

  const pollEntityId = event.transaction.to!.toHex()
  const poll = Poll.load(pollEntityId)
  if (poll == null) {
    log.error('Error: handlePublishMessage failed poll not found {}', [
      pollEntityId,
    ])
    return
  }

  const fundingRoundId = poll.fundingRound
  if (!fundingRoundId) {
    log.error(
      'Error: handlePublishMessage failed poll {} missing funding round',
      [pollEntityId]
    )
    return
  }

  const messageID =
    event.transaction.hash.toHexString() +
    '-' +
    event.transactionLogIndex.toString()

  const timestamp = event.block.timestamp.toString()
  const message = new Message(messageID)
  message.data = event.params._message.data
  message.msgType = event.params._message.msgType
  message.blockNumber = event.block.number
  message.transactionIndex = event.transaction.index
  message.submittedBy = event.transaction.from

  const publicKeyId = makePublicKeyId(
    fundingRoundId,
    event.params._encPubKey.x,
    event.params._encPubKey.y
  )
  const publicKey = PublicKey.load(publicKeyId)

  //NOTE: If the public keys aren't being tracked initialize them
  if (publicKey == null) {
    const publicKey = new PublicKey(publicKeyId)
    publicKey.x = event.params._encPubKey.x
    publicKey.y = event.params._encPubKey.y
    publicKey.fundingRound = fundingRoundId

    publicKey.save()
  }

  message.publicKey = publicKeyId
  message.timestamp = timestamp

  message.poll = pollEntityId
  message.fundingRound = fundingRoundId
  message.save()
  log.info('handlePublishMessage', [])
}
