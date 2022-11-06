import getCommandsByCategory from "../../../getcommands.js"
import { EmbedBuilder } from 'discord.js'

const help = async interaction => {
	const commandsByCategory = await getCommandsByCategory()

	const fields = []

	for (const categoryName of Object.keys(commandsByCategory)) {
		const commandsStrings = []
		for (const command of commandsByCategory[categoryName]) {
			commandsStrings.push(`\`/${command.data.name}\`: ${command.data.description}`)
		}
		const field = {
			name: categoryName.toUpperCase(),
			value: commandsStrings.join(`\n`)
		}
		fields.push(field)
	}

	const embed = new EmbedBuilder()
		.setColor('#A50A39')
		.setTitle('Commands list')
		.setDescription('List of commands for this bot')
		.addFields(...fields)

	interaction.reply({embeds: [embed]})
}

export default help