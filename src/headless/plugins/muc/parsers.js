import dayjs from 'dayjs';
import {
    StanzaParseError,
    getChatMarker,
    getChatState,
    getCorrectionAttributes,
    getEncryptionAttributes,
    getErrorAttributes,
    getOpenGraphMetadata,
    getOutOfBandAttributes,
    getReceiptId,
    getReferences,
    getRetractionAttributes,
    getSpoilerAttributes,
    getStanzaIDs,
    isArchived,
    isCarbon,
    isHeadline,
    isValidReceiptRequest,
    rejectUnencapsulatedForward,
} from '@converse/headless/shared/parsers';
import { api, converse } from '@converse/headless/core';

const { Strophe, sizzle, u } = converse.env;
const { NS } = Strophe;

/**
 * @private
 * @param { XMLElement } stanza - The message stanza
 * @param { XMLElement } original_stanza - The original stanza, that contains the
 *  message stanza, if it was contained, otherwise it's the message stanza itself.
 * @returns { Object }
 */
function getModerationAttributes (stanza) {
    const fastening = sizzle(`apply-to[xmlns="${Strophe.NS.FASTEN}"]`, stanza).pop();
    if (fastening) {
        const applies_to_id = fastening.getAttribute('id');
        const moderated = sizzle(`moderated[xmlns="${Strophe.NS.MODERATE}"]`, fastening).pop();
        if (moderated) {
            const retracted = sizzle(`retract[xmlns="${Strophe.NS.RETRACT}"]`, moderated).pop();
            if (retracted) {
                return {
                    'editable': false,
                    'moderated': 'retracted',
                    'moderated_by': moderated.getAttribute('by'),
                    'moderated_id': applies_to_id,
                    'moderation_reason': moderated.querySelector('reason')?.textContent
                };
            }
        }
    } else {
        const tombstone = sizzle(`> moderated[xmlns="${Strophe.NS.MODERATE}"]`, stanza).pop();
        if (tombstone) {
            const retracted = sizzle(`retracted[xmlns="${Strophe.NS.RETRACT}"]`, tombstone).pop();
            if (retracted) {
                return {
                    'editable': false,
                    'is_tombstone': true,
                    'moderated_by': tombstone.getAttribute('by'),
                    'retracted': tombstone.getAttribute('stamp'),
                    'moderation_reason': tombstone.querySelector('reason')?.textContent
                };
            }
        }
    }
    return {};
}

/**
 * Parses a passed in message stanza and returns an object of attributes.
 * @param { XMLElement } stanza - The message stanza
 * @param { XMLElement } original_stanza - The original stanza, that contains the
 *  message stanza, if it was contained, otherwise it's the message stanza itself.
 * @param { _converse.ChatRoom } chatbox
 * @param { _converse } _converse
 * @returns { Promise<MUCMessageAttributes|Error> }
 */
export async function parseMUCMessage (stanza, chatbox, _converse) {
    const err = rejectUnencapsulatedForward(stanza);
    if (err) {
        return err;
    }

    const selector = `[xmlns="${NS.MAM}"] > forwarded[xmlns="${NS.FORWARD}"] > message`;
    const original_stanza = stanza;
    stanza = sizzle(selector, stanza).pop() || stanza;

    if (sizzle(`message > forwarded[xmlns="${Strophe.NS.FORWARD}"]`, stanza).length) {
        return new StanzaParseError(
            `Invalid Stanza: Forged MAM groupchat message from ${stanza.getAttribute('from')}`,
            stanza
        );
    }
    const delay = sizzle(`delay[xmlns="${Strophe.NS.DELAY}"]`, original_stanza).pop();
    const from = stanza.getAttribute('from');
    const nick = Strophe.unescapeNode(Strophe.getResourceFromJid(from));
    const marker = getChatMarker(stanza);
    const now = new Date().toISOString();
    /**
     * @typedef { Object } MUCMessageAttributes
     * The object which {@link parseMUCMessage} returns
     * @property { ('me'|'them') } sender - Whether the message was sent by the current user or someone else
     * @property { Array<Object> } references - A list of objects representing XEP-0372 references
     * @property { Boolean } editable - Is this message editable via XEP-0308?
     * @property { Boolean } is_archived -  Is this message from a XEP-0313 MAM archive?
     * @property { Boolean } is_carbon - Is this message a XEP-0280 Carbon?
     * @property { Boolean } is_delayed - Was delivery of this message was delayed as per XEP-0203?
     * @property { Boolean } is_encrypted -  Is this message XEP-0384  encrypted?
     * @property { Boolean } is_error - Whether an error was received for this message
     * @property { Boolean } is_headline - Is this a "headline" message?
     * @property { Boolean } is_markable - Can this message be marked with a XEP-0333 chat marker?
     * @property { Boolean } is_marker - Is this message a XEP-0333 Chat Marker?
     * @property { Boolean } is_only_emojis - Does the message body contain only emojis?
     * @property { Boolean } is_spoiler - Is this a XEP-0382 spoiler message?
     * @property { Boolean } is_tombstone - Is this a XEP-0424 tombstone?
     * @property { Boolean } is_unstyled - Whether XEP-0393 styling hints should be ignored
     * @property { Boolean } is_valid_receipt_request - Does this message request a XEP-0184 receipt (and is not from us or a carbon or archived message)
     * @property { Object } encrypted -  XEP-0384 encryption payload attributes
     * @property { String } body - The contents of the <body> tag of the message stanza
     * @property { String } chat_state - The XEP-0085 chat state notification contained in this message
     * @property { String } edited - An ISO8601 string recording the time that the message was edited per XEP-0308
     * @property { String } error_condition - The defined error condition
     * @property { String } error_text - The error text received from the server
     * @property { String } error_type - The type of error received from the server
     * @property { String } from - The sender JID (${muc_jid}/${nick})
     * @property { String } from_muc - The JID of the MUC from which this message was sent
     * @property { String } from_real_jid - The real JID of the sender, if available
     * @property { String } fullname - The full name of the sender
     * @property { String } marker - The XEP-0333 Chat Marker value
     * @property { String } marker_id - The `id` attribute of a XEP-0333 chat marker
     * @property { String } moderated - The type of XEP-0425 moderation (if any) that was applied
     * @property { String } moderated_by - The JID of the user that moderated this message
     * @property { String } moderated_id - The  XEP-0359 Stanza ID of the message that this one moderates
     * @property { String } moderation_reason - The reason provided why this message moderates another
     * @property { String } msgid - The root `id` attribute of the stanza
     * @property { String } nick - The MUC nickname of the sender
     * @property { String } oob_desc - The description of the XEP-0066 out of band data
     * @property { String } oob_url - The URL of the XEP-0066 out of band data
     * @property { String } origin_id - The XEP-0359 Origin ID
     * @property { String } receipt_id - The `id` attribute of a XEP-0184 <receipt> element
     * @property { String } received - An ISO8601 string recording the time that the message was received
     * @property { String } replace_id - The `id` attribute of a XEP-0308 <replace> element
     * @property { String } retracted - An ISO8601 string recording the time that the message was retracted
     * @property { String } retracted_id - The `id` attribute of a XEP-424 <retracted> element
     * @property { String } spoiler_hint  The XEP-0382 spoiler hint
     * @property { String } stanza_id - The XEP-0359 Stanza ID. Note: the key is actualy `stanza_id ${by_jid}` and there can be multiple.
     * @property { String } subject - The <subject> element value
     * @property { String } thread - The <thread> element value
     * @property { String } time - The time (in ISO8601 format), either given by the XEP-0203 <delay> element, or of receipt.
     * @property { String } to - The recipient JID
     * @property { String } type - The type of message
     */
    let attrs = Object.assign(
        {
            from,
            nick,
            'body': stanza.querySelector('body')?.textContent?.trim(),
            'chat_state': getChatState(stanza),
            'from_muc': Strophe.getBareJidFromJid(from),
            'from_real_jid': chatbox.occupants.findOccupant({ nick })?.get('jid'),
            'is_archived': isArchived(original_stanza),
            'is_carbon': isCarbon(original_stanza),
            'is_delayed': !!delay,
            'is_headline': isHeadline(stanza),
            'is_markable': !!sizzle(`markable[xmlns="${Strophe.NS.MARKERS}"]`, stanza).length,
            'is_marker': !!marker,
            'is_unstyled': !!sizzle(`unstyled[xmlns="${Strophe.NS.STYLING}"]`, stanza).length,
            'marker_id': marker && marker.getAttribute('id'),
            'msgid': stanza.getAttribute('id') || original_stanza.getAttribute('id'),
            'receipt_id': getReceiptId(stanza),
            'received': new Date().toISOString(),
            'references': getReferences(stanza),
            'subject': stanza.querySelector('subject')?.textContent,
            'thread': stanza.querySelector('thread')?.textContent,
            'time': delay ? dayjs(delay.getAttribute('stamp')).toISOString() : now,
            'to': stanza.getAttribute('to'),
            'type': stanza.getAttribute('type')
        },
        getErrorAttributes(stanza),
        getOutOfBandAttributes(stanza),
        getSpoilerAttributes(stanza),
        getCorrectionAttributes(stanza, original_stanza),
        getStanzaIDs(stanza, original_stanza),
        getOpenGraphMetadata(stanza),
        getRetractionAttributes(stanza, original_stanza),
        getModerationAttributes(stanza),
        getEncryptionAttributes(stanza, _converse)
    );

    await api.emojis.initialize();
    attrs = Object.assign(
        {
            'is_only_emojis': attrs.body ? u.isOnlyEmojis(attrs.body) : false,
            'is_valid_receipt_request': isValidReceiptRequest(stanza, attrs),
            'message': attrs.body || attrs.error, // TODO: Remove and use body and error attributes instead
            'sender': attrs.nick === chatbox.get('nick') ? 'me' : 'them'
        },
        attrs
    );

    if (attrs.is_archived && original_stanza.getAttribute('from') !== attrs.from_muc) {
        return new StanzaParseError(
            `Invalid Stanza: Forged MAM message from ${original_stanza.getAttribute('from')}`,
            stanza
        );
    } else if (attrs.is_archived && original_stanza.getAttribute('from') !== chatbox.get('jid')) {
        return new StanzaParseError(
            `Invalid Stanza: Forged MAM groupchat message from ${stanza.getAttribute('from')}`,
            stanza
        );
    } else if (attrs.is_carbon) {
        return new StanzaParseError('Invalid Stanza: MUC messages SHOULD NOT be XEP-0280 carbon copied', stanza);
    }
    // We prefer to use one of the XEP-0359 unique and stable stanza IDs as the Model id, to avoid duplicates.
    attrs['id'] = attrs['origin_id'] || attrs[`stanza_id ${attrs.from_muc || attrs.from}`] || u.getUniqueId();
    /**
     * *Hook* which allows plugins to add additional parsing
     * @event _converse#parseMUCMessage
     */
    return api.hook('parseMUCMessage', stanza, attrs);
}

/**
 * Given an IQ stanza with a member list, create an array of objects containing
 * known member data (e.g. jid, nick, role, affiliation).
 * @private
 * @method muc_utils#parseMemberListIQ
 * @returns { MemberListItem[] }
 */
export function parseMemberListIQ (iq) {
    return sizzle(`query[xmlns="${Strophe.NS.MUC_ADMIN}"] item`, iq).map(item => {
        /**
         * @typedef {Object} MemberListItem
         * Either the JID or the nickname (or both) will be available.
         * @property {string} affiliation
         * @property {string} [role]
         * @property {string} [jid]
         * @property {string} [nick]
         */
        const data = {
            'affiliation': item.getAttribute('affiliation')
        };
        const jid = item.getAttribute('jid');
        if (u.isValidJID(jid)) {
            data['jid'] = jid;
        } else {
            // XXX: Prosody sends nick for the jid attribute value
            // Perhaps for anonymous room?
            data['nick'] = jid;
        }
        const nick = item.getAttribute('nick');
        if (nick) {
            data['nick'] = nick;
        }
        const role = item.getAttribute('role');
        if (role) {
            data['role'] = nick;
        }
        return data;
    });
}

/**
 * Parses a passed in MUC presence stanza and returns an object of attributes.
 * @method parseMUCPresence
 * @param { XMLElement } stanza - The presence stanza
 * @returns { Object }
 */
export function parseMUCPresence (stanza) {
    const from = stanza.getAttribute('from');
    const type = stanza.getAttribute('type');
    const data = {
        'from': from,
        'nick': Strophe.getResourceFromJid(from),
        'type': type,
        'states': [],
        'hats': [],
        'show': type !== 'unavailable' ? 'online' : 'offline'
    };
    Array.from(stanza.children).forEach(child => {
        if (child.matches('status')) {
            data.status = child.textContent || null;
        } else if (child.matches('show')) {
            data.show = child.textContent || 'online';
        } else if (child.matches('x') && child.getAttribute('xmlns') === Strophe.NS.MUC_USER) {
            Array.from(child.children).forEach(item => {
                if (item.nodeName === 'item') {
                    data.affiliation = item.getAttribute('affiliation');
                    data.role = item.getAttribute('role');
                    data.jid = item.getAttribute('jid');
                    data.nick = item.getAttribute('nick') || data.nick;
                } else if (item.nodeName == 'status' && item.getAttribute('code')) {
                    data.states.push(item.getAttribute('code'));
                }
            });
        } else if (child.matches('x') && child.getAttribute('xmlns') === Strophe.NS.VCARDUPDATE) {
            data.image_hash = child.querySelector('photo')?.textContent;
        } else if (child.matches('hats') && child.getAttribute('xmlns') === Strophe.NS.MUC_HATS) {
            data['hats'] = Array.from(child.children).map(
                c =>
                    c.matches('hat') && {
                        'title': c.getAttribute('title'),
                        'uri': c.getAttribute('uri')
                    }
            );
        }
    });
    return data;
}