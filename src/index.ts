import path from 'path';
import axios from 'axios';
import * as t from 'io-ts';
import fs, { promises as fsPromises } from 'fs';

const config = {
	textsLang: 'pol',
	textsAuthor: 'adam-mickiewicz',
	reqConcurrency: 10,
	apiBaseUrl: 'https://wolnelektury.pl/api',
};

const outputPath = path.join(__dirname, '..', 'output');
const outputRawPath = path.join(outputPath, 'raw');

const TextsDataCodec = t.array(
	t.type({
		slug: t.string,
	})
);

const TextDetailCodec = t.type({
	language: t.literal(config.textsLang), // check if `language` exists and is an exact string
	children: t.refinement(t.array(t.string), (children) => children.length === 0), // check if `children` exists and is empty
	txt: t.string, // check if `txt` exists and is a string
});

/**
 * Perform multiple concurrent HTTPS requests and optionally process them.
 *
 * @async
 * @function makeConcurrentHttpsReqs
 *
 * @param {string[]} urls - Array of URLs that the rqeuests will be performed on (or a string that will be formated in to an URL).
 * @param {number} concurrency - Number of concurrent requests.
 * @param {(accumulator: any[], currentAxiosResponseObj: any) => any[]} [processData] - Reduce function for processsing the responses.
 * @param {(url: string) => string} [formatUrl] - Function for formatting the `urls` strings before performing requests.
 * @returns {Promise<any[]>} Results of the HTTPS requests / output of the `processData` function.
 *
 * @example
 * console.log(await makeConcurrentHttpsReqs(
 *     slugs,
 * 	   5,
 * 	   undefined,
 *     (slug) => `https://example.com/api/${slug}/`
 * ));
 * @example
 * await Promise.all(await makeConcurrentHttpsReqs(
 *         txtUrls,
 *         10,
 *         (acc, currRes) => {
 * 	           const {
 * 	               config: {url},
 * 	        	   data
 * 	            } = currRes;
 *
 *              acc.push(fsPromises.writeFile(path.join(outputRawPath, url.split('/').pop()), data));
 *
 *              return acc;
 *         }
 *     )
 * );
 * @example
 * console.log(await makeConcurrentHttpsReqs(
 *     slugs,
 *     15,
 *     (acc, currRes) => {
 *         const { data } = currRes;
 *
 *         // Check properties:
 *         const { children, txt: txtUrl } = textDetailObj;
 *         if (children.length === 0) {
 *             acc.push(txtUrl);
 *         }
 *
 *         return acc;
 *     },
 *     (slug) => `https://example.com/api/${slug}/`
 * ));
 */
const makeConcurrentHttpsReqs = async (
	urls: string[],
	concurrency: number,
	processData?: (accumulator: any[], currentAxiosResponseObj: any) => any[],
	formatUrl?: (url: string) => string
): Promise<any[]> => {
	let final: any[] = [];
	let reqResults: any[] = [];

	// Go through slugs by batch (dictated by concurrency):
	for (let i = 0; i < urls.length; i += concurrency) {
		// Get batch of urls:
		const urlBatch = urls.slice(i, i + concurrency);

		// Perform requests on batch, concurrently:
		reqResults.push(
			...(await Promise.all(
				urlBatch.map((url) => axios.get(formatUrl ? formatUrl(url) : url, { timeout: 10000 }))
			))
		);
	}

	if (processData) {
		final = reqResults.reduce((acc, reqResult) => processData(acc, reqResult), []);
	} else {
		reqResults.forEach((reqResult) => final.push(reqResult.data));
	}

	return final;
};

(async () => {
	console.clear();
	const startTime = performance.now();

	// Check if `/output/raw` folders don't exist:
	if (!fs.existsSync(outputRawPath)) {
		// Create them:
		fs.mkdirSync(outputRawPath, { recursive: true });

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

		// Filter out collections of works and get URLs of single ones:
		const txtUrls = await makeConcurrentHttpsReqs(
			slugs,
			config.reqConcurrency,
			(acc, currRes) => {
				const { data: textDetailObj } = currRes;

				// Check the properties:
				const textsDetailResult = TextDetailCodec.decode(textDetailObj);
				if (textsDetailResult._tag === 'Right') {
					acc.push(textsDetailResult.right.txt);
				}

				return acc;
			},
			(slug) => `${config.apiBaseUrl}/books/${slug}/`
		);

		// Download and write texts to files:
		await Promise.all(
			await makeConcurrentHttpsReqs(txtUrls, config.reqConcurrency, (acc, currRes) => {
				const {
					config: { url },
					data: text,
				} = currRes;

				acc.push(fsPromises.writeFile(path.join(outputRawPath, url.split('/').pop()), text));

				return acc;
			})
		);

		console.log(fs.readdirSync(outputRawPath).length);
	}

	// Print execution time:
	console.log(`\n@ Done in: ${(performance.now() - startTime).toFixed(2)} ms`);
})();
