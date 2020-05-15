/**
 * @module converse-profile
 * @copyright The Converse.js contributors
 * @license Mozilla Public License (MPLv2)
 */
import "@converse/headless/converse-status";
import "@converse/headless/converse-vcard";
import "converse-modal";
import ChatStatusModal from "modals/chat-status.js";
import ProfileModal from "modals/profile.js";
import UserSettingsModal from "modals/user-settings";
import tpl_profile from "templates/profile.js";
import { converse } from "@converse/headless/converse-core";


converse.plugins.add('converse-profile', {

    dependencies: ["converse-status", "converse-modal", "converse-vcard", "converse-chatboxviews"],

    initialize () {
        /* The initialize function gets called as soon as the plugin is
         * loaded by converse.js's plugin machinery.
         */
        const { _converse } = this;
        const { api } = _converse;
        const { __ } = _converse;

        api.settings.update({
            'allow_adhoc_commands': true,
            'show_client_info': true
        });

        _converse.XMPPStatusView = _converse.ViewWithAvatar.extend({
            tagName: "div",
            events: {
                "click a.show-profile": "showProfileModal",
                "click a.change-status": "showStatusChangeModal",
                "click .logout": "logOut"
            },

            initialize () {
                this.listenTo(this.model, "change", this.render);
                this.listenTo(this.model.vcard, "change", this.render);
            },

            toHTML () {
                const chat_status = this.model.get('status') || 'offline';
                return tpl_profile(Object.assign(
                    this.model.toJSON(),
                    this.model.vcard.toJSON(), {
                    chat_status,
                    'fullname': this.model.vcard.get('fullname') || _converse.bare_jid,
                    "showUserSettingsModal": ev => this.showUserSettingsModal(ev),
                    'status_message': this.model.get('status_message') ||
                                        __("I am %1$s", this.getPrettyStatus(chat_status)),
                }));
            },

            afterRender () {
                this.renderAvatar();
            },

            showProfileModal (ev) {
                ev.preventDefault();
                if (this.profile_modal === undefined) {
                    this.profile_modal = new ProfileModal({model: this.model});
                }
                this.profile_modal.show(ev);
            },

            showStatusChangeModal (ev) {
                ev.preventDefault();
                if (this.status_modal === undefined) {
                    this.status_modal = new ChatStatusModal({model: this.model});
                }
                this.status_modal.show(ev);
            },

            showUserSettingsModal(ev) {
                ev.preventDefault();
                if (this.user_settings_modal === undefined) {
                    this.user_settings_modal = new UserSettingsModal({model: this.model, _converse});
                }
                this.user_settings_modal.show(ev);
            },

            logOut (ev) {
                ev.preventDefault();
                const result = confirm(__("Are you sure you want to log out?"));
                if (result === true) {
                    api.user.logout();
                }
            },

            getPrettyStatus (stat) {
                if (stat === 'chat') {
                    return __('online');
                } else if (stat === 'dnd') {
                    return __('busy');
                } else if (stat === 'xa') {
                    return __('away for long');
                } else if (stat === 'away') {
                    return __('away');
                } else if (stat === 'offline') {
                    return __('offline');
                } else {
                    return __(stat) || __('online');
                }
            }
        });


        /******************** Event Handlers ********************/
        api.listen.on('controlBoxPaneInitialized', async view => {
            await api.waitUntil('VCardsInitialized');
            _converse.xmppstatusview = new _converse.XMPPStatusView({'model': _converse.xmppstatus});
            view.el.insertAdjacentElement('afterBegin', _converse.xmppstatusview.render().el);
        });
    }
});
