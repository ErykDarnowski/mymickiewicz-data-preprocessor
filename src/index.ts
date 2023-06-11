import axios from 'axios';
import * as t from 'io-ts';

const config = {
	textsAuthor: 'adam-mickiewicz',
	apiBaseUrl: 'https://wolnelektury.pl/api',
};

const TextsDataCodec = t.array(
	t.type({
		slug: t.string,
	})
);

(async () => {
	console.clear();
	const startTime = performance.now();

	// Get texts data:
	const { data: textsData } = await axios.get(
		`${config.apiBaseUrl}/authors/${config.textsAuthor}/books/`,
		{ timeout: 5000 }
	);

	// Check response format:
	const textsDataResult = TextsDataCodec.decode(textsData);
	if (textsDataResult._tag === 'Left') {
		throw new Error('invalid texts data req response format');
	}

	// Extract slugs from the response:
	const slugs = textsDataResult.right.map((textObj) => textObj.slug);

	console.log(slugs);

	// Print execution time:
	console.log(`\n@ Done in: ${(performance.now() - startTime).toFixed(2)} ms`);
})();
