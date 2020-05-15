import tpl_user_details_modal from "../templates/user_details_modal.js";
import { BootstrapModal } from "../converse-modal.js";
import { __ } from '@converse/headless/i18n';
import { _converse, api } from "@converse/headless/converse-core";
import log from "@converse/headless/log";

const u = converse.env.utils;


export default BootstrapModal.extend({
    id: "user-details-modal",

    events: {
        'click button.refresh-contact': 'refreshContact',
        'click .fingerprint-trust .btn input': 'toggleDeviceTrust'
    },

    initialize () {
        BootstrapModal.prototype.initialize.apply(this, arguments);
        this.model.rosterContactAdded.then(() => this.registerContactEventHandlers());
        this.listenTo(this.model, 'change', this.render);
        this.registerContactEventHandlers();
        /**
         * Triggered once the UserDetailsModal has been initialized
         * @event _converse#userDetailsModalInitialized
         * @type { _converse.ChatBox }
         * @example _converse.api.listen.on('userDetailsModalInitialized', chatbox => { ... });
         */
        api.trigger('userDetailsModalInitialized', this.model);
    },

    toHTML () {
        const vcard = this.model?.vcard;
        const vcard_json = vcard ? vcard.toJSON() : {};
        return tpl_user_details_modal(Object.assign(
            this.model.toJSON(),
            vcard_json, {
            '_converse': _converse,
            'allow_contact_removal': _converse.allow_contact_removal,
            'display_name': this.model.getDisplayName(),
            'is_roster_contact': this.model.contact !== undefined,
            'removeContact': ev => this.removeContact(ev),
            'view': this,
            'utils': u
        }));
    },

    registerContactEventHandlers () {
        if (this.model.contact !== undefined) {
            this.listenTo(this.model.contact, 'change', this.render);
            this.listenTo(this.model.contact.vcard, 'change', this.render);
            this.model.contact.on('destroy', () => {
                delete this.model.contact;
                this.render();
            });
        }
    },

    async refreshContact (ev) {
        if (ev && ev.preventDefault) { ev.preventDefault(); }
        const refresh_icon = this.el.querySelector('.fa-refresh');
        u.addClass('fa-spin', refresh_icon);
        try {
            await api.vcard.update(this.model.contact.vcard, true);
        } catch (e) {
            log.fatal(e);
            this.alert(__('Sorry, something went wrong while trying to refresh'), 'danger');
        }
        u.removeClass('fa-spin', refresh_icon);
    },

    removeContact (ev) {
        if (ev && ev.preventDefault) { ev.preventDefault(); }
        if (!_converse.allow_contact_removal) { return; }
        const result = confirm(__("Are you sure you want to remove this contact?"));
        if (result === true) {
            this.modal.hide();
            // XXX: This is annoying but necessary to get tests to pass.
            // The `dismissHandler` in bootstrap.native tries to
            // reference the remove button after it's been cleared from
            // the DOM, so we delay removing the contact to give it time.
            setTimeout(() => {
                this.model.contact.removeFromRoster(
                    () => this.model.contact.destroy(),
                    (err) => {
                        log.error(err);
                        api.alert('error', __('Error'), [
                            __('Sorry, there was an error while trying to remove %1$s as a contact.',
                            this.model.contact.getDisplayName())
                        ]);
                    }
                );
            }, 1);
        }
    },
});
