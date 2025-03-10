import { strict as assert } from 'node:assert/strict'
import * as v1_instance from 'wildebeest/functions/api/v1/instance'
import * as apps from 'wildebeest/functions/api/v1/apps'
import * as custom_emojis from 'wildebeest/functions/api/v1/custom_emojis'
import { makeDB, assertCORS, assertJSON, assertCache, createTestClient } from './utils'
import { createPerson } from 'wildebeest/backend/src/activitypub/actors'
import { createSubscription } from '../src/mastodon/subscription'
import * as subscription from 'wildebeest/functions/api/v1/push/subscription'
import { configure, generateVAPIDKeys } from 'wildebeest/backend/src/config'

const userKEK = 'test_kek'
const domain = 'cloudflare.com'

describe('Mastodon APIs', () => {
	describe('instance', () => {
		test('return the instance infos v1', async () => {
			const db = await makeDB()
			const data = {
				title: 'title',
				uri: 'uri',
				email: 'email',
				description: 'description',
			}
			await configure(db, data)

			const res = await v1_instance.handleRequest(domain, db)
			assert.equal(res.status, 200)
			assertCORS(res)
			assertJSON(res)

			{
				const data = await res.json<any>()
				assert.equal(data.rules.length, 0)
				assert.equal(data.uri, domain)
			}
		})

		test('adds a short_description if missing', async () => {
			const db = await makeDB()
			const data = {
				title: 'title',
				uri: 'uri',
				email: 'email',
				description: 'description',
			}
			await configure(db, data)

			const res = await v1_instance.handleRequest(domain, db)
			assert.equal(res.status, 200)

			{
				const data = await res.json<any>()
				assert.equal(data.short_description, 'description')
			}
		})
	})

	describe('apps', () => {
		test('return the app infos', async () => {
			const db = await makeDB()
			await generateVAPIDKeys(db)
			const request = new Request('https://example.com', {
				method: 'POST',
				body: '{"redirect_uris":"mastodon://joinmastodon.org/oauth","website":"https://app.joinmastodon.org/ios","client_name":"Mastodon for iOS","scopes":"read write follow push"}',
			})

			const res = await apps.handleRequest(db, request)
			assert.equal(res.status, 200)
			assertCORS(res)
			assertJSON(res)

			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			const { name, website, redirect_uri, client_id, client_secret, vapid_key, ...rest } = await res.json<
				Record<string, string>
			>()

			assert.equal(name, 'Mastodon for iOS')
			assert.equal(website, 'https://app.joinmastodon.org/ios')
			assert.equal(redirect_uri, 'mastodon://joinmastodon.org/oauth')
			assert.deepEqual(rest, {})
		})

		test('returns 404 for GET request', async () => {
			const request = new Request('https://example.com')
			const ctx: any = {
				next: () => new Response(),
				data: null,
				env: {},
				request,
			}

			const res = await apps.onRequest(ctx)
			assert.equal(res.status, 400)
		})
	})

	describe('custom emojis', () => {
		test('returns an empty array', async () => {
			const res = await custom_emojis.onRequest()
			assert.equal(res.status, 200)
			assertJSON(res)
			assertCORS(res)
			assertCache(res, 300)

			const data = await res.json<any>()
			assert.equal(data.length, 0)
		})
	})

	describe('subscriptions', () => {
		test('get non existing subscription', async () => {
			const db = await makeDB()
			const req = new Request('https://example.com')
			const client = await createTestClient(db)
			const connectedActor = await createPerson(domain, db, userKEK, 'sven@cloudflare.com')

			const res = await subscription.handleGetRequest(db, req, connectedActor, client.id)
			assert.equal(res.status, 404)
		})

		test('get existing subscription', async () => {
			const db = await makeDB()
			const req = new Request('https://example.com')
			const client = await createTestClient(db)
			const connectedActor = await createPerson(domain, db, userKEK, 'sven@cloudflare.com')

			const data: any = {
				subscription: {
					endpoint: 'https://endpoint.com',
					keys: {
						p256dh: 'p256dh',
						auth: 'auth',
					},
				},
				data: {
					alerts: {},
					policy: 'all',
				},
			}
			await createSubscription(db, connectedActor, client, data)

			const res = await subscription.handleGetRequest(db, req, connectedActor, client.id)
			assert.equal(res.status, 200)

			const out = await res.json<any>()
			assert.equal(typeof out.id, 'number')
			assert.equal(out.endpoint, data.subscription.endpoint)
		})

		test('create subscription', async () => {
			const db = await makeDB()
			const client = await createTestClient(db)
			await generateVAPIDKeys(db)
			const connectedActor = await createPerson(domain, db, userKEK, 'sven@cloudflare.com')

			const data: any = {
				subscription: {
					endpoint: 'https://endpoint.com',
					keys: {
						p256dh: 'p256dh',
						auth: 'auth',
					},
				},
				data: {
					alerts: {},
					policy: 'all',
				},
			}
			const req = new Request('https://example.com', {
				method: 'POST',
				body: JSON.stringify(data),
			})

			const res = await subscription.handlePostRequest(db, req, connectedActor, client.id)
			assert.equal(res.status, 200)

			const row: any = await db.prepare('SELECT * FROM subscriptions').first()
			assert.equal(row.actor_id, connectedActor.id.toString())
			assert.equal(row.client_id, client.id)
			assert.equal(row.endpoint, data.subscription.endpoint)
		})

		test('create subscriptions only creates one', async () => {
			const db = await makeDB()
			const client = await createTestClient(db)
			await generateVAPIDKeys(db)
			const connectedActor = await createPerson(domain, db, userKEK, 'sven@cloudflare.com')

			const data: any = {
				subscription: {
					endpoint: 'https://endpoint.com',
					keys: {
						p256dh: 'p256dh',
						auth: 'auth',
					},
				},
				data: {
					alerts: {},
					policy: 'all',
				},
			}
			await createSubscription(db, connectedActor, client, data)

			const req = new Request('https://example.com', {
				method: 'POST',
				body: JSON.stringify(data),
			})

			const res = await subscription.handlePostRequest(db, req, connectedActor, client.id)
			assert.equal(res.status, 200)

			const { count } = await db.prepare('SELECT count(*) as count FROM subscriptions').first()
			assert.equal(count, 1)
		})
	})
})
