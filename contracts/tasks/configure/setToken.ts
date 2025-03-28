/**
 * Set the native token in the ClrFund contract
 * Sample usage:
 *
 * yarn hardhat set-token --token <token address> --clrfund <clrfund address> --network <network>
 */

import { task } from 'hardhat/config'
import { Contract } from 'ethers'
import { deployContract } from '../../utils/deployment'
import { UNIT } from '../../utils/constants'
import { EContracts } from '../../utils/types'

/**
 * Set the token address in the ClrFund contract
 *
 * @param clrfundContract ClrFund contract
 * @param tokenAddress The token address to set in ClrFund
 */
async function setToken(clrfundContract: Contract, tokenAddress: string) {
  const tx = await clrfundContract.setToken(tokenAddress)
  await tx.wait()

  console.log(`Token set at tx: ${tx.hash}`)
}

task('set-token', 'Set the token in ClrFund')
  .addParam('clrfund', 'The ClrFund contract address')
  .addOptionalParam('token', 'The token address')
  .addOptionalParam('tokenAmount', 'Initial token amount', '1000')
  .setAction(async ({ clrfund, token, tokenAmount }, { ethers }) => {
    const [signer] = await ethers.getSigners()
    const clrfundContract = await ethers.getContractAt(
      EContracts.ClrFund,
      clrfund,
      signer
    )
    console.log('Setting token by', signer.address)

    let tokenAddress: string = token || ''
    if (!tokenAddress) {
      const initialTokenSupply = BigInt(tokenAmount) * UNIT
      const tokenContract = await deployContract({
        name: EContracts.AnyOldERC20Token,
        contractArgs: [initialTokenSupply],
        ethers,
      })
      tokenAddress = await tokenContract.getAddress()
      console.log('New token address', tokenAddress)
    }
    await setToken(clrfundContract, tokenAddress)
  })
