async function retry(action, retries = 3, delay = 2000) {

    for (let attempt = 1; attempt <= retries; attempt++) {

        try {

            return await action();

        } catch (error) {

            console.log(`⚠️ Încercarea ${attempt} a eșuat.`);

            if (attempt === retries) {

                throw error;

            }

            await new Promise(resolve =>

                setTimeout(resolve, delay)

            );

        }

    }

}

module.exports = {

    retry

};