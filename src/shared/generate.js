import requestBatch from '../artificial intelligence/requestbatch.js'
import novelAIPrefix from '../artificial intelligence/novelaiprefix.json' assert { type: 'json' }
import { getLocalizedText } from '../locale/languages.js'
import colors from '../colors.json' assert { type: 'json' }
import config from '../../config.json' assert { type: 'json' }
import { AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js'
import fetch from 'node-fetch'

const MAX_PIXEL_COUNT = 1536 * 1024
const getRequestedPixelCount = (width = 512, height = 512, scale = 1) => {
	return (width * scale) * (height * scale)
}

const setJobDone = (...embeds) => {
	const color = colors.complete
	for (const embed of embeds)
		embed
			.setColor(color)
}

export const generate = async (interaction, parameters) => {

	// resolution validation
	const requestedPixelCount = getRequestedPixelCount(
		parameters.width, 
		parameters.height,
		parameters[`hr-scale`],
	)
	if (requestedPixelCount > MAX_PIXEL_COUNT) {
		const resTooHighText = getLocalizedText("dream fail resolution too high", interaction.locale)

		return interaction[interaction.deferred || interaction.replied ? 'followUp' : 'reply']({ 
			content: resTooHighText, 
			ephemeral: true 
		})
	}

	const isEphemeral = parameters.private ?? false

	console.log(`Heartbeat ping: ${interaction.client.ws.ping}ms`)

	const thinkingText = getLocalizedText("generating images", interaction.locale)
	const method = interaction.isButton() || interaction.isModalSubmit() ? `followUp` : `reply`
	const reply = await interaction[method]({ 
		content: `<a:loading:1050454241266909249> ${thinkingText}`, 
		fetchReply: true, 
		ephemeral: isEphemeral 
	})

	console.log(`Roundtrip latency: ${reply.createdTimestamp - interaction.createdTimestamp}ms`)

	// img2img
	const isImg2Img = typeof parameters.image !== `undefined`
	let base64InputImage = null
	if (isImg2Img) {
		const inputImageUrlData = await fetch(parameters.image.url)
		const inputImageBuffer = await inputImageUrlData.arrayBuffer()
		base64InputImage = `data:image/png;base64,${Buffer.from(inputImageBuffer).toString('base64')}`
	}

	// controlnet
	const isControlNet = typeof parameters["controlnet-image"] !== `undefined`
	let base64ControlNetImage = null
	if (isControlNet) {
		const inputImageUrlData = await fetch(parameters["controlnet-image"].url)
		const inputImageBuffer = await inputImageUrlData.arrayBuffer()
		base64ControlNetImage = `data:image/png;base64,${Buffer.from(inputImageBuffer).toString('base64')}`
	}

	// novelAI prefixing
	const promptParts = [parameters.prompt]
	const negativePromptParts = [parameters?.negative]

	if (parameters.prefix ?? true) {
		promptParts.unshift(novelAIPrefix.promptPrefix)
		negativePromptParts.unshift(novelAIPrefix.negativePrefix)
	}

	const finalPrompt = promptParts.filter(s => s?.trim()).join(`, `)
	const finalNegativePrompt = negativePromptParts.filter(s => s?.trim()).join(`, `)

	// request images
	const requests = 
		await requestBatch(
			finalPrompt, 
			finalNegativePrompt,
			parameters.seed,
			base64InputImage,
			parameters.denoising,
			parameters["variation-seed"],
			parameters["variation-strength"],
			parameters.steps,
			parameters.cfg,
			parameters.width,
			parameters.height,
			parameters.sampler,
			parameters["hr-scale"],
			parameters["scale-latent"],
			parameters["clip-skip"],
			parameters.batch, 
			base64ControlNetImage,
			parameters["controlnet-model"],
			parameters["controlnet-module"],
			parameters["controlnet-weight"],
			parameters["controlnet-guidance-start"],
			parameters["controlnet-guidance-end"],
			parameters["controlnet-mode"],
		)

	// handle responses
	const cacheChannelId = config.cacheChannelId
	const cacheChannel = await interaction.client.channels.cache.get(cacheChannelId)

	// cache the parameters to use on the 'repeat' button
	const paramCacheMessage = 
		await cacheChannel
			.send({ content: '```json\n' + JSON.stringify(parameters) + '```' })
			.catch(err => {
				console.log('could not cache parameters\n', err)
			})

	const embeds = []
	for (const [index, request] of requests.entries()) {
		const response = await request.catch(console.error)
		const data = await response.json()
		const buffers = data.images.map(i => Buffer.from(i, "base64"))
		const filename = `${data.parameters.seed}.png`
		const attachments = buffers.map(buffer => {
			return new AttachmentBuilder(buffer, { name: filename })
		})

		const cacheMessage = await cacheChannel.send({ files: attachments })
		const attachmentsUrls = [...cacheMessage.attachments.values()].map(attach => attach.url)
		const imageUrls = (isControlNet ? attachmentsUrls : [attachmentsUrls[0]]).slice(0, 4)

		const numberOfImages = requests.length
		const isLastImage = index === requests.length - 1
		const color = colors.incomplete

		const descLocale = getLocalizedText("dream response description", interaction.locale)

		for (const imageUrl of imageUrls) {
			const embed = new EmbedBuilder()
				.setURL(paramCacheMessage?.url ?? `https://github.com/TiagoMarinho/Soph`)
				.setImage(imageUrl)
				.setColor(color)
				.setDescription(descLocale)
				.setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() })
				.addFields({ name: `Seed`, value: `\`\`\`${data.parameters.seed}\`\`\``, inline: true })
				//.addFields({ name: `Prompt`, value: `${data.parameters.prompt}`, inline: false })
				.setFooter({ text: `${index + 1}/${numberOfImages}` })

			if (isControlNet)
				embed.setThumbnail(parameters["controlnet-image"].url)
			else if (isImg2Img)
				embed.setThumbnail(parameters.image.url)

			//if (data.parameters.negative_prompt)
			//	embed
			//		.addFields({ name: `Negative prompt`, value: `${data.parameters.negative_prompt}`, inline: false })

			embeds.unshift(embed)
		}

		if (isLastImage)
			setJobDone(...embeds)
		
		// buttons
		const rowData = []
		
		// add previous/next buttons (arrows)
		if (numberOfImages > 1)
			rowData.push([
				{ emoji: `1045215673690886224`, id: `previous`, style: ButtonStyle.Primary, disabled: !isLastImage },
				{ emoji: `1045215671438540821`, id: `next`, style: ButtonStyle.Primary, disabled: !isLastImage },
			])
		
		// add repeat, edit and enhance button.
		if (!isEphemeral && paramCacheMessage) {
			const generationButtons = [
				{ emoji: `1050058817360101498`, id: `repeat`, style: ButtonStyle.Success, disabled: !isLastImage },
				{ emoji: `1058978647043735582`, id: `edit`, style: ButtonStyle.Success, disabled: !isLastImage }
			]

			if (parameters['hr-scale'] == null && !isImg2Img && !isControlNet) {
				generationButtons.push({ emoji: '1050092899083227166', id: 'enhance', style: ButtonStyle.Success, disabled: !isLastImage })
			}

			if (rowData.length > 0) 
				rowData[0].push(...generationButtons)
			else 
				rowData.push(generationButtons)
		}

		const rows = rowData.map(buttonData => {
			const row = new ActionRowBuilder()

			const buttons = buttonData.map(button =>
				new ButtonBuilder()
					.setCustomId(button.id)
					.setEmoji(button.emoji)
					.setStyle(button.style)
					.setDisabled(button.disabled === true)
			)

			row.addComponents(...buttons)

			return row
		})

		const replyInstance = isEphemeral ? interaction : reply
		const editReplyMethod = isEphemeral ? `editReply` : `edit`

		await replyInstance[editReplyMethod]({ embeds: embeds, components: rows, content: '' })
			.catch(err => {
				console.error(err)
			})
	}
}

export default generate