const Card = require("../../Card");

module.exports = class KillAlignedOnDeath extends Card {
  constructor(role) {
    super(role);

    if (role.alignment == "Independent") {
      return;
    }

    this.listeners = {
      roleAssigned: function (player) {
        if (player !== this.player) {
          return;
        }

        this.player.role.data.position = this.player.role.modifier;
        if (this.player.role.name === "President") {
          this.player.role.data.position = this.player.role.name;
        }

        this.game.queueAlert(
          `${this.player.name} has been elected as the ${this.player.role.data.position}! Protect them at all costs!`,
          0,
          this.game.players.filter(
            (p) => p.role.alignment === this.player.role.alignment
          )
        );
      },
      death: function (player, killer, killType, instant) {
        if (player !== this.player) {
          return;
        }

        for (let p of this.game.alivePlayers()) {
          if (p.role.alignment === this.player.role.alignment) {
            p.kill("basic", this.player, instant);
          }
        }
      },
    };
  }
};
